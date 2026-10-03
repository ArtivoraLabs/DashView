"""Tiny async cache: in-process by default, Redis when REDIS_URL is set
(so several replicas share Odoo results, uid lookups and rate-limit counters)."""
from __future__ import annotations

import json
import time
from typing import Any


class MemoryCache:
    def __init__(self, max_items: int = 5000) -> None:
        self._d: dict[str, tuple[float, Any]] = {}
        self._max = max_items

    async def get(self, key: str) -> Any | None:
        hit = self._d.get(key)
        if not hit:
            return None
        if hit[0] < time.monotonic():
            self._d.pop(key, None)
            return None
        return hit[1]

    async def set(self, key: str, value: Any, ttl: float) -> None:
        if len(self._d) >= self._max:
            now = time.monotonic()
            for k in [k for k, (exp, _) in self._d.items() if exp < now]:
                self._d.pop(k, None)
            while len(self._d) >= self._max:  # still full: drop oldest-expiring
                self._d.pop(min(self._d, key=lambda k: self._d[k][0]), None)
        self._d[key] = (time.monotonic() + ttl, value)

    async def incr(self, key: str, ttl: float) -> int:
        cur = await self.get(key)
        n = (cur or 0) + 1
        exp = self._d[key][0] if cur else time.monotonic() + ttl
        self._d[key] = (exp, n)
        return n

    async def close(self) -> None:
        self._d.clear()


class RedisCache:
    def __init__(self, url: str) -> None:
        import redis.asyncio as redis

        self._r = redis.from_url(url, decode_responses=True)

    async def get(self, key: str) -> Any | None:
        raw = await self._r.get("dv:" + key)
        return None if raw is None else json.loads(raw)

    async def set(self, key: str, value: Any, ttl: float) -> None:
        await self._r.set("dv:" + key, json.dumps(value, default=str), ex=max(1, int(ttl)))

    async def incr(self, key: str, ttl: float) -> int:
        k = "dv:" + key
        n = await self._r.incr(k)
        if n == 1:
            await self._r.expire(k, max(1, int(ttl)))
        return int(n)

    async def close(self) -> None:
        await self._r.aclose()


def build_cache(redis_url: str = ""):
    return RedisCache(redis_url) if redis_url else MemoryCache()
