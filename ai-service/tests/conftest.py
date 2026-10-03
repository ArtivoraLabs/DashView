import json

import httpx
import jwt
import pytest

from app.config import Settings
from app.llm.base import LLMResult, ProviderError, ToolCall
from app.main import create_app

SECRET = "test-secret-that-is-at-least-32-bytes-long"


def fake_odoo_transport(calls: list | None = None) -> httpx.MockTransport:
    def handler(request: httpx.Request) -> httpx.Response:
        body = json.loads(request.content)
        p = body["params"]
        svc, method, args = p["service"], p["method"], p["args"]
        if calls is not None:
            calls.append((svc, method, args))
        if svc == "common" and method == "authenticate":
            result = 7 if args[2] == "good-key" else False
        elif svc == "common" and method == "version":
            result = {"server_version": "18.0"}
        else:
            _db, _uid, _key, model, m, a, kw = args
            if m == "read_group":
                fields, groupby = a[1], a[2]
                aggs = {f.split(":")[0]: 8000.0 for f in fields if f != "__count"}
                if not groupby:
                    result = [{**aggs, "__count": 6}]
                else:
                    g = groupby[0]
                    result = [
                        {g: [1, "Acme"], **{k: 5000.0 for k in aggs}, "__count": 4},
                        {g: [2, "Globex"], **{k: 3000.0 for k in aggs}, "__count": 2},
                    ]
            elif model == "res.company":
                result = [{"id": 1, "currency_id": [3, "PKR"]}]
            elif m == "search_count":
                result = 42
            elif m == "fields_get":
                result = {"name": {"type": "char", "string": "Name", "store": True},
                          "password": {"type": "char", "string": "Pwd", "store": True},
                          "amount_total": {"type": "monetary", "string": "Total", "store": True}}
            elif m == "search_read":
                result = [{"id": 1, "name": "SO001", "partner_id": [1, "Acme"], "note": False}]
            else:
                result = []
        return httpx.Response(200, json={"jsonrpc": "2.0", "id": body["id"], "result": result})

    return httpx.MockTransport(handler)


class ScriptedProvider:
    """Returns pre-baked LLMResults in order; raises ProviderError if given one."""

    def __init__(self, name, script):
        self.name, self.script, self.seen = name, list(script), []

    async def complete(self, **kw):
        self.seen.append(kw)
        item = self.script.pop(0)
        if isinstance(item, Exception):
            raise item
        return item


def settings(**over) -> Settings:
    base = dict(auth_required=True, jwt_secret=SECRET, allowed_roles="owner,admin", odoo_url="https://x.odoo.com",
                odoo_db="db", odoo_username="u", odoo_api_key="good-key", rate_limit_per_min=100,
                cache_ttl_data_s=0, _env_file=None)
    base.update(over)
    return Settings(**base)


def token(role="admin"):
    return jwt.encode({"id": 1, "email": "a@b.c", "role": role}, SECRET, algorithm="HS256")


@pytest.fixture
def make_app():
    def _make(providers, calls=None, **over):
        return create_app(settings(**over), providers=providers, transport=fake_odoo_transport(calls))
    return _make


def tool_call_result(name, args, id="t1"):
    return LLMResult(text="", tool_calls=[ToolCall(id, name, args)])
