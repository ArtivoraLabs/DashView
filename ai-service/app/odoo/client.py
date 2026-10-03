"""Async, read-only Odoo JSON-RPC client.

* one shared httpx connection pool for the whole process
* per-host concurrency cap so a busy assistant can't hammer Odoo
* uid / schema / data results cached (memory or Redis)
* only read methods can be called at all (READ_METHODS)
* SSRF checks when credentials come from the browser instead of the env
"""
from __future__ import annotations

import asyncio
import hashlib
import ipaddress
import json
import secrets
import socket
from dataclasses import dataclass
from typing import Any
from urllib.parse import urlparse

import httpx

from ..config import Settings

READ_METHODS = {
    "search_read", "search_count", "read", "read_group", "formatted_read_group",
    "fields_get", "name_search",
}


class OdooError(Exception):
    def __init__(self, message: str, status: int = 502) -> None:
        super().__init__(message)
        self.status = status


@dataclass(frozen=True)
class OdooConfig:
    url: str
    db: str
    username: str
    api_key: str

    @property
    def base(self) -> str:
        u = self.url.strip().rstrip("/")
        return u if u.lower().startswith(("http://", "https://")) else "https://" + u

    @property
    def fingerprint(self) -> str:
        raw = "|".join((self.base, self.db, self.username, self.api_key))
        return hashlib.sha256(raw.encode()).hexdigest()[:24]

    @classmethod
    def from_settings(cls, s: Settings) -> "OdooConfig | None":
        if s.odoo_url and s.odoo_db and s.odoo_username and s.odoo_api_key:
            return cls(s.odoo_url, s.odoo_db, s.odoo_username, s.odoo_api_key)
        return None


_SEMAPHORES: dict[str, asyncio.Semaphore] = {}


def _semaphore(host: str, n: int) -> asyncio.Semaphore:
    sem = _SEMAPHORES.get(host)
    if sem is None:
        sem = _SEMAPHORES[host] = asyncio.Semaphore(n)
    return sem


def _host_matches(host: str, patterns: list[str]) -> bool:
    host = host.lower()
    for p in patterns:
        p = p.lower()
        if p.startswith("*."):
            if host.endswith(p[1:]):
                return True
        elif host == p:
            return True
    return False


async def assert_safe_client_url(url: str, settings: Settings) -> None:
    """Applied only to browser-supplied Odoo URLs (env-configured ones are trusted)."""
    if not settings.odoo_allow_client_credentials:
        raise OdooError("Sending Odoo credentials per request is disabled on this server.", 403)
    parsed = urlparse(url if "://" in url else "https://" + url)
    if parsed.scheme not in ("http", "https") or not parsed.hostname:
        raise OdooError("Invalid Odoo URL.", 400)
    host = parsed.hostname
    if settings.allowed_hosts:
        if not _host_matches(host, settings.allowed_hosts):
            raise OdooError("This Odoo host is not on the server's allow-list.", 403)
        return
    # No allow-list: at least refuse private / loopback / link-local targets.
    loop = asyncio.get_running_loop()
    try:
        infos = await loop.getaddrinfo(host, None, type=socket.SOCK_STREAM)
    except socket.gaierror:
        raise OdooError("Could not resolve the Odoo host.", 400)
    for info in infos:
        ip = ipaddress.ip_address(info[4][0])
        if ip.is_private or ip.is_loopback or ip.is_link_local or ip.is_reserved or ip.is_multicast:
            raise OdooError("Odoo host resolves to a non-public address; set ODOO_ALLOWED_HOSTS to allow it.", 403)


class OdooClient:
    def __init__(self, cfg: OdooConfig, http: httpx.AsyncClient, cache, settings: Settings) -> None:
        self.cfg = cfg
        self._http = http
        self._cache = cache
        self._s = settings
        self._sem = _semaphore(urlparse(cfg.base).netloc, settings.odoo_max_concurrency_per_host)

    # ── transport ────────────────────────────────────────────────────
    async def _rpc(self, service: str, method: str, args: list) -> Any:
        payload = {
            "jsonrpc": "2.0", "method": "call",
            "params": {"service": service, "method": method, "args": args},
            "id": secrets.randbelow(10**9),
        }
        last: Exception | None = None
        for attempt in range(3):  # reads are idempotent, so retrying is safe
            try:
                try:
                    await asyncio.wait_for(self._sem.acquire(), timeout=self._s.odoo_queue_timeout_s)
                except TimeoutError:
                    raise OdooError("Odoo is busy; retry this request shortly.", 503)
                try:
                    r = await self._http.post(
                        self.cfg.base + "/jsonrpc", json=payload, timeout=self._s.odoo_timeout_s
                    )
                finally:
                    self._sem.release()
                break
            except OdooError:
                raise
            except (httpx.TimeoutException, httpx.TransportError) as e:
                last = e
                if attempt < 2:
                    await asyncio.sleep(0.4 * 2**attempt)
        else:
            if isinstance(last, httpx.TimeoutException):
                raise OdooError("Odoo did not respond in time.", 504)
            raise OdooError("Could not reach Odoo.", 502)

        if r.status_code >= 400:
            raise OdooError(f"Odoo responded with HTTP {r.status_code}.", 502)
        try:
            body = r.json()
        except ValueError:
            raise OdooError("Odoo returned a non-JSON response.", 502)
        if body.get("error"):
            data = body["error"].get("data") or {}
            msg = data.get("message") or body["error"].get("message") or "Odoo RPC error"
            status = 403 if "access" in msg.lower() and "denied" in msg.lower() else 400
            raise OdooError(msg.strip().splitlines()[0][:400] if msg else "Odoo RPC error", status)
        return body.get("result")

    async def uid(self) -> int:
        key = "uid:" + self.cfg.fingerprint
        cached = await self._cache.get(key)
        if cached:
            return int(cached)
        uid = await self._rpc("common", "authenticate", [self.cfg.db, self.cfg.username, self.cfg.api_key, {}])
        if not uid:
            raise OdooError("Odoo authentication failed - check database, username and API key.", 401)
        await self._cache.set(key, int(uid), 3600)
        return int(uid)

    async def call(self, model: str, method: str, args: list | None = None,
                   kwargs: dict | None = None, *, ttl: float | None = None) -> Any:
        if method not in READ_METHODS:
            raise OdooError(f"Odoo method '{method}' is not allowed (read-only service).", 403)
        args, kwargs = args or [], kwargs or {}
        ckey = None
        if ttl:
            digest = hashlib.sha256(json.dumps([model, method, args, kwargs], sort_keys=True, default=str).encode())
            ckey = f"q:{self.cfg.fingerprint}:{digest.hexdigest()[:32]}"
            hit = await self._cache.get(ckey)
            if hit is not None:
                return hit
        uid = await self.uid()
        result = await self._rpc("object", "execute_kw",
                                 [self.cfg.db, uid, self.cfg.api_key, model, method, args, kwargs])
        if ckey:
            await self._cache.set(ckey, result, ttl)
        return result

    # ── convenience wrappers (all read-only) ─────────────────────────
    async def test(self) -> dict:
        version = await self._rpc("common", "version", [])
        uid = await self.uid()
        return {"uid": uid, "server_version": (version or {}).get("server_version")}

    async def fields_get(self, model: str) -> dict:
        return await self.call(model, "fields_get", [],
                               {"attributes": ["string", "type", "relation", "selection", "store"]},
                               ttl=self._s.cache_ttl_schema_s)

    async def search_read(self, model: str, domain: list, fields: list[str], limit: int,
                          order: str | None = None, offset: int = 0) -> list[dict]:
        kw: dict[str, Any] = {"limit": limit, "offset": offset}
        if fields:
            kw["fields"] = fields
        if order:
            kw["order"] = order
        return await self.call(model, "search_read", [domain], kw, ttl=self._s.cache_ttl_data_s)

    async def search_count(self, model: str, domain: list) -> int:
        return await self.call(model, "search_count", [domain], ttl=self._s.cache_ttl_data_s)

    async def read(self, model: str, ids: list[int], fields: list[str]) -> list[dict]:
        kw = {"fields": fields} if fields else {}
        return await self.call(model, "read", [ids], kw, ttl=self._s.cache_ttl_data_s)

    async def read_group(self, model: str, domain: list, measures: list[str], groupby: list[str],
                         orderby: str | None = None, limit: int | None = None,
                         offset: int = 0) -> list[dict]:
        kw: dict[str, Any] = {"lazy": False}
        if orderby:
            kw["orderby"] = orderby
        if limit:
            kw["limit"] = limit
        if offset:
            kw["offset"] = offset
        try:
            return await self.call(model, "read_group", [domain, measures, groupby], kw,
                                   ttl=self._s.cache_ttl_data_s)
        except OdooError as e:
            # Newer Odoo versions deprecate read_group in favour of formatted_read_group.
            # Best-effort fallback; shapes are normalised in tools.py.
            if "read_group" not in str(e) and "attribute" not in str(e).lower():
                raise
            aggs = [m if (":" in m or m == "__count") else m + ":sum" for m in measures]
            kw2: dict[str, Any] = {}
            if orderby:
                kw2["order"] = orderby
            if limit:
                kw2["limit"] = limit
            if offset:
                kw2["offset"] = offset
            return await self.call(model, "formatted_read_group", [domain, groupby, aggs], kw2,
                                   ttl=self._s.cache_ttl_data_s)
