from __future__ import annotations

import hmac

import jwt
from fastapi import HTTPException, Request


class Principal(dict):
    @property
    def id(self) -> str:
        return str(self.get("id") or self.get("email") or "anonymous")


def authenticate(request: Request) -> Principal:
    s = request.app.state.settings
    if not s.auth_required:
        return Principal(id="dev", role="owner")

    key = request.headers.get("x-api-key")
    if key and s.api_keys and any(hmac.compare_digest(key, k) for k in s.api_keys):
        return Principal(id="service:" + key[:4], role="owner")

    header = request.headers.get("authorization", "")
    if header.lower().startswith("bearer ") and s.jwt_secret:
        try:
            payload = jwt.decode(header[7:], s.jwt_secret, algorithms=["HS256"])
        except jwt.PyJWTError:
            raise HTTPException(401, "Invalid or expired session.")
        p = Principal(payload)
        if p.get("role") not in s.roles:
            raise HTTPException(403, "Your role is not allowed to use the AI assistant.")
        return p
    raise HTTPException(401, "Not authenticated.")


async def rate_limit(request: Request, principal: Principal) -> None:
    limit = request.app.state.settings.rate_limit_per_min
    if limit <= 0:
        return
    n = await request.app.state.cache.incr(f"rl:{principal.id}", 60)
    if n > limit:
        raise HTTPException(429, "Too many requests - slow down a little.", headers={"Retry-After": "30"})
