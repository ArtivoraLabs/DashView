import asyncio

from fastapi.testclient import TestClient

from app.llm.base import LLMResult, ProviderError
from app.llm.registry import DEFAULT_CATALOG, plan, pick_tier
from tests.conftest import ScriptedProvider, token, tool_call_result

ASK = {"messages": [{"role": "user", "content": "top customers?"}], "stream": False}
H = lambda role="admin": {"Authorization": f"Bearer {token(role)}"}


def test_full_tool_loop_returns_answer(make_app):
    prov = ScriptedProvider("anthropic", [
        tool_call_result("odoo_aggregate", {"model": "sale.order", "groupby": ["partner_id"], "measures": ["amount_total:sum"]}),
        LLMResult(text="Acme leads with 5000.", usage={"input_tokens": 10, "output_tokens": 5}),
    ])
    with TestClient(make_app({"anthropic": prov})) as c:
        r = c.post("/v1/chat", json=ASK, headers=H())
    assert r.status_code == 200, r.text
    j = r.json()
    assert j["text"] == "Acme leads with 5000." and j["tools"] == ["odoo_aggregate"]
    assert r.headers["X-Request-ID"] == j["request_id"]
    # the 2nd model call must have seen the tool output
    assert prov.seen[1]["turns"][0].outputs[0].count("Acme") == 1


def test_failover_to_next_provider(make_app):
    bad = ScriptedProvider("anthropic", [ProviderError("529 overloaded")])
    good = ScriptedProvider("openai", [LLMResult(text="ok from openai")])
    with TestClient(make_app({"anthropic": bad, "openai": good})) as c:
        r = c.post("/v1/chat", json=ASK, headers=H())
    assert r.json()["provider"] == "openai"


def test_auth_and_roles(make_app):
    prov = ScriptedProvider("anthropic", [LLMResult(text="hi")])
    with TestClient(make_app({"anthropic": prov})) as c:
        assert c.post("/v1/chat", json=ASK).status_code == 401
        assert c.post("/v1/chat", json=ASK, headers={"Authorization": "Bearer nope"}).status_code == 401
        assert c.post("/v1/chat", json=ASK, headers=H("viewer")).status_code == 403
        assert c.get("/health").status_code == 200


def test_rate_limit(make_app):
    prov = ScriptedProvider("anthropic", [LLMResult(text="a")] * 5)
    with TestClient(make_app({"anthropic": prov}, rate_limit_per_min=2)) as c:
        codes = [c.post("/v1/chat", json=ASK, headers=H()).status_code for _ in range(3)]
    assert codes == [200, 200, 429]


def test_sse_stream_events(make_app):
    prov = ScriptedProvider("anthropic", [tool_call_result("odoo_count", {"model": "sale.order"}), LLMResult(text="42")])
    with TestClient(make_app({"anthropic": prov})) as c:
        r = c.post("/v1/chat", json={**ASK, "stream": True}, headers=H())
    body = r.text
    assert "event: tool_start" in body and "event: tool_result" in body and "event: final" in body and "event: done" in body
    assert r.headers["X-Request-ID"] in body


def test_request_id_is_propagated_and_unsafe_values_are_replaced(make_app):
    prov = ScriptedProvider("anthropic", [LLMResult(text="hi")])
    with TestClient(make_app({"anthropic": prov})) as c:
        supplied = c.post("/v1/chat", json=ASK, headers={**H(), "X-Request-ID": "report-2026.09"})
        invalid = c.get("/health", headers={"X-Request-ID": "bad id"})
    assert supplied.headers["X-Request-ID"] == "report-2026.09"
    assert supplied.json()["request_id"] == "report-2026.09"
    assert invalid.headers["X-Request-ID"] != "bad id"


def test_chat_total_content_is_bounded(make_app):
    prov = ScriptedProvider("anthropic", [LLMResult(text="unused")])
    body = {"messages": [{"role": "user", "content": "x" * 8000}] * 5, "stream": False}
    with TestClient(make_app({"anthropic": prov})) as c:
        response = c.post("/v1/chat", json=body, headers=H())
    assert response.status_code == 422


def test_chat_backpressure_returns_retryable_service_unavailable(make_app):
    prov = ScriptedProvider("anthropic", [LLMResult(text="unused")])
    app = make_app({"anthropic": prov}, chat_queue_timeout_s=0.01)
    with TestClient(app) as c:
        app.state.chat_semaphore = asyncio.Semaphore(0)
        response = c.post("/v1/chat", json=ASK, headers=H())
    assert response.status_code == 503 and response.headers["Retry-After"] == "1"
    assert prov.seen == []


def test_tool_budget_forces_final_answer(make_app):
    loops = [tool_call_result("odoo_count", {"model": "sale.order"}, id=f"t{i}") for i in range(3)]
    prov = ScriptedProvider("anthropic", loops + [LLMResult(text="best effort")])
    with TestClient(make_app({"anthropic": prov}, max_tool_hops=3)) as c:
        r = c.post("/v1/chat", json=ASK, headers=H())
    assert r.json()["text"] == "best effort"
    assert prov.seen[-1]["allow_tools"] is False


def test_no_provider_configured(make_app):
    with TestClient(make_app({})) as c:
        r = c.post("/v1/chat", json=ASK, headers=H())
    assert r.status_code == 502 and "No AI provider" in r.json()["error"]


def test_client_credentials_disabled_by_default(make_app):
    prov = ScriptedProvider("anthropic", [LLMResult(text="x")])
    body = {**ASK, "odoo": {"url": "https://evil.example.com", "db": "d", "username": "u", "apiKey": "k"}}
    with TestClient(make_app({"anthropic": prov})) as c:
        assert c.post("/v1/chat", json=body, headers=H()).status_code in (400, 403)


def test_routing():
    avail = {"anthropic", "openai"}
    pri = ["anthropic", "openai"]
    assert pick_tier("how many orders?", "auto") == "fast"
    assert pick_tier("how many orders?", "auto", "smart") == "smart"   # accuracy floor
    assert pick_tier("hi", "fast", "smart") == "fast"                 # explicit choice wins
    assert pick_tier("compare revenue by month and explain why", "auto") == "smart"
    chain = plan(DEFAULT_CATALOG, avail, pri, "how many orders?")
    assert chain[0].id == "claude-haiku-4-5-20251001" and chain[1].provider == "openai"
    assert plan(DEFAULT_CATALOG, avail, pri, "x", "deep")[0].id == "claude-opus-5-5"
    assert plan(DEFAULT_CATALOG, avail, pri, "x", "auto", "gpt-5.6-sol")[0].id == "gpt-5.6-sol"
    assert plan(DEFAULT_CATALOG, set(), pri, "x") == []


def test_audit_and_feedback(make_app, tmp_path):
    log = tmp_path / "audit.jsonl"
    prov = ScriptedProvider("anthropic", [tool_call_result("odoo_metric", {"metric": "sales_total", "period": "last_month"}),
                                          LLMResult(text="Total 8,000")])
    with TestClient(make_app({"anthropic": prov}, audit_log_file=str(log))) as c:
        j = c.post("/v1/chat", json=ASK, headers=H()).json()
        assert j["tools"] == ["odoo_metric"]
        fb = c.post("/v1/feedback", json={"request_id": j["request_id"], "rating": "down", "expected": "9,100"}, headers=H())
        assert fb.status_code == 200
        assert any(m["key"] == "sales_total" for m in c.get("/v1/metrics", headers=H()).json()["metrics"])
    import json
    recs = [json.loads(l) for l in log.read_text().splitlines()]
    assert recs[0]["kind"] == "chat" and recs[0]["tools"][0]["args"]["metric"] == "sales_total"
    assert recs[1]["kind"] == "feedback" and recs[1]["request_id"] == j["request_id"]
