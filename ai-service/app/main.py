from __future__ import annotations

import asyncio
import json
import logging
import re
import uuid

import httpx
from fastapi import Depends, FastAPI, HTTPException, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse, StreamingResponse
from contextlib import asynccontextmanager

import time

from .agent import stream_agent
from .audit import Audit
from .cache import build_cache
from .config import Settings, get_settings
from .llm.registry import build_providers, load_catalog, plan
from .odoo.client import OdooClient, OdooConfig, OdooError, assert_safe_client_url
from .odoo.guard import Guard
from .odoo.metrics import load_metrics
from .odoo.tools import ToolContext
from .schemas import ChatRequest, Feedback
from .security import Principal, authenticate, rate_limit

logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(name)s %(message)s")
log = logging.getLogger("api")


def create_app(settings: Settings | None = None, *, providers: dict | None = None,
               transport: httpx.AsyncBaseTransport | None = None) -> FastAPI:
    settings = settings or get_settings()

    @asynccontextmanager
    async def lifespan(app: FastAPI):
        app.state.settings = settings
        app.state.cache = build_cache(settings.redis_url)
        app.state.http = httpx.AsyncClient(
            transport=transport,
            limits=httpx.Limits(max_connections=100, max_keepalive_connections=20),
            headers={"User-Agent": "dashview-ai-service/1.0"},
        )
        app.state.providers = providers if providers is not None else build_providers(settings)
        app.state.catalog = load_catalog(settings)
        app.state.metrics = load_metrics(settings.metrics_file)
        app.state.audit = Audit(settings.audit_log_file)
        app.state.chat_semaphore = asyncio.Semaphore(settings.max_chat_concurrency)
        if settings.env == "prod":
            if not settings.cors_list or "*" in settings.cors_list:
                raise RuntimeError("CORS_ORIGINS must contain an explicit origin in production")
            if len(settings.jwt_secret) < 32:
                raise RuntimeError("JWT_SECRET must be at least 32 characters in production")
            if settings.odoo_allow_client_credentials and not settings.allowed_hosts:
                raise RuntimeError("ODOO_ALLOWED_HOSTS is required when client credentials are enabled")
        yield
        await app.state.http.aclose()
        await app.state.cache.close()

    app = FastAPI(title="DashView AI Service", version="1.0.0", lifespan=lifespan,
                  docs_url=None if settings.env == "prod" else "/docs", redoc_url=None)
    app.add_middleware(CORSMiddleware, allow_origins=settings.cors_list, allow_methods=["GET", "POST"],
                       allow_headers=["Authorization", "Content-Type", "X-API-Key", "X-Request-ID"],
                       expose_headers=["X-Request-ID"])

    @app.middleware("http")
    async def request_observability(request: Request, call_next):
        incoming_id = request.headers.get("x-request-id", "")
        rid = incoming_id if re.fullmatch(r"[A-Za-z0-9._-]{1,64}", incoming_id) else uuid.uuid4().hex
        request.state.request_id = rid
        started = time.monotonic()

        def log_completion(status_code: int):
            log.info("request_complete request_id=%s method=%s path=%s status=%s latency_ms=%d",
                     rid, request.method, request.url.path, status_code,
                     round((time.monotonic() - started) * 1000))

        response = await call_next(request)
        response.headers["X-Request-ID"] = rid
        if hasattr(response, "body_iterator"):
            body_iterator = response.body_iterator

            async def observe_body():
                try:
                    async for chunk in body_iterator:
                        yield chunk
                finally:
                    log_completion(response.status_code)

            response.body_iterator = observe_body()
        else:
            log_completion(response.status_code)
        return response

    @app.exception_handler(OdooError)
    async def odoo_error_handler(request: Request, exc: OdooError):
        return JSONResponse({"ok": False, "error": str(exc)}, status_code=exc.status)

    async def resolve_client(request: Request, body_odoo) -> OdooClient:
        s: Settings = request.app.state.settings
        cfg = None
        if body_odoo is not None:
            await assert_safe_client_url(body_odoo.url, s)
            cfg = OdooConfig(body_odoo.url, body_odoo.db, body_odoo.username, body_odoo.api_key)
        cfg = cfg or OdooConfig.from_settings(s)
        if cfg is None:
            raise HTTPException(400, "Odoo is not configured on the server (ODOO_URL/DB/USERNAME/API_KEY).")
        return OdooClient(cfg, request.app.state.http, request.app.state.cache, s)

    @app.get("/health")
    async def health():
        return {"ok": True}

    @app.get("/v1/models")
    async def models(request: Request, principal: Principal = Depends(authenticate)):
        avail = set(request.app.state.providers)
        return {"models": [m.__dict__ for m in request.app.state.catalog if m.provider in avail],
                "providers": sorted(avail)}

    @app.get("/v1/metrics")
    async def metrics_list(request: Request, principal: Principal = Depends(authenticate)):
        return {"metrics": [{"key": m.key, "title": m.title, "definition": m.definition, "groupable": list(m.groupable)}
                            for m in request.app.state.metrics.values()], "timezone": request.app.state.settings.timezone}

    @app.post("/v1/feedback")
    async def feedback(fb: Feedback, request: Request, principal: Principal = Depends(authenticate)):
        await request.app.state.audit.record({"kind": "feedback", "user": principal.id, **fb.model_dump()})
        return {"ok": True}

    @app.post("/v1/odoo/test")
    async def odoo_test(request: Request, principal: Principal = Depends(authenticate)):
        client = await resolve_client(request, None)
        try:
            return {"ok": True, **await client.test()}
        except OdooError as e:
            return JSONResponse({"ok": False, "error": str(e)}, status_code=e.status)

    @app.post("/v1/chat")
    async def chat(req: ChatRequest, request: Request, principal: Principal = Depends(authenticate)):
        await rate_limit(request, principal)
        st = request.app.state
        client = await resolve_client(request, req.odoo)
        ctx = ToolContext(client=client, guard=Guard(st.settings), metrics=st.metrics, tz=st.settings.timezone)
        history = [m.model_dump() for m in req.messages]
        if history[-1]["role"] != "user":
            raise HTTPException(400, "The last message must be from the user.")
        chain = plan(st.catalog, set(st.providers), st.settings.priority, history[-1]["content"], req.tier, req.model,
                     st.settings.auto_min_tier)
        rid = request.state.request_id
        try:
            await asyncio.wait_for(st.chat_semaphore.acquire(), timeout=st.settings.chat_queue_timeout_s)
        except TimeoutError:
            raise HTTPException(503, "The AI service is busy; retry shortly.",
                                headers={"Retry-After": "1"})
        log.info("chat rid=%s user=%s chain=%s", rid, principal.id, [m.id for m in chain][:3])
        raw_events = stream_agent(history=history, ctx=ctx, chain=chain, providers=st.providers, settings=st.settings)

        async def events_gen():
            """Pass events through while collecting an audit record."""
            t0, tools, answer, err, model = time.monotonic(), {}, None, None, None
            try:
                async for ev in raw_events:
                    if ev["type"] == "tool_start":
                        tools[ev["id"]] = {"name": ev["name"], "args": ev["args"]}
                    elif ev["type"] == "tool_result" and ev["id"] in tools:
                        tools[ev["id"]]["result"] = ev["summary"]
                    elif ev["type"] == "final":
                        answer, model = ev["text"], ev["model"]
                    elif ev["type"] == "error":
                        err = ev["message"]
                    ev = {**ev, "request_id": rid}
                    yield ev
            finally:
                await st.audit.record({"kind": "chat", "request_id": rid, "user": principal.id, "question": history[-1]["content"],
                                       "model": model, "tools": list(tools.values()), "answer": answer, "error": err,
                                       "latency_s": round(time.monotonic() - t0, 2)})

        events = events_gen()

        if not req.stream:
            tools_used, final, error = [], None, None
            try:
                async for ev in events:
                    if ev["type"] == "tool_start":
                        tools_used.append(ev["name"])
                    elif ev["type"] == "final":
                        final = ev
                    elif ev["type"] == "error":
                        error = ev["message"]
            finally:
                st.chat_semaphore.release()
            if final is None:
                return JSONResponse({"ok": False, "error": error or "No answer produced.", "request_id": rid},
                                    status_code=502)
            return {"ok": True, "text": final["text"], "model": final["model"], "provider": final["provider"],
                    "usage": final["usage"], "tools": tools_used, "request_id": final["request_id"]}

        async def sse():
            try:
                async for ev in events:
                    yield f"event: {ev['type']}\ndata: {json.dumps(ev, default=str)}\n\n"
            except asyncio.CancelledError:
                raise
            except Exception:  # noqa: BLE001
                log.exception("stream failed rid=%s", rid)
                yield f'event: error\ndata: {json.dumps({"type": "error", "message": "Internal error.", "request_id": rid})}\n\n'
            finally:
                try:
                    await events.aclose()
                finally:
                    st.chat_semaphore.release()
            yield f"event: done\ndata: {json.dumps({'request_id': rid})}\n\n"

        return StreamingResponse(sse(), media_type="text/event-stream",
                                 headers={"Cache-Control": "no-cache", "X-Accel-Buffering": "no",
                                          "X-Request-ID": rid})

    return app


app = create_app() if __name__ != "__main__" else None
