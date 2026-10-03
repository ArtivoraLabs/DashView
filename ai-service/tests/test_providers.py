import json

from app.llm.anthropic_provider import AnthropicProvider
from app.llm.base import ToolCall, ToolTurn
from app.llm.openai_compat import OpenAICompatProvider

HISTORY = [{"role": "user", "content": "hi"}]
TURNS = [ToolTurn("checking", [ToolCall("c1", "odoo_count", {"model": "sale.order"})], ['{"count": 3}'])]


def test_anthropic_wire_format():
    m = AnthropicProvider._messages(HISTORY, TURNS)
    assert m[1]["content"][0] == {"type": "text", "text": "checking"}
    assert m[1]["content"][1]["type"] == "tool_use" and m[1]["content"][1]["input"] == {"model": "sale.order"}
    assert m[2]["role"] == "user" and m[2]["content"][0] == {"type": "tool_result", "tool_use_id": "c1", "content": '{"count": 3}'}


def test_openai_wire_format():
    m = OpenAICompatProvider._messages("SYS", HISTORY, TURNS)
    assert m[0] == {"role": "system", "content": "SYS"}
    a = m[2]
    assert a["role"] == "assistant" and json.loads(a["tool_calls"][0]["function"]["arguments"]) == {"model": "sale.order"}
    assert m[3] == {"role": "tool", "tool_call_id": "c1", "content": '{"count": 3}'}


def test_sdk_clients_construct():
    assert AnthropicProvider("sk-test").name == "anthropic"
    for n in ("openai", "xai", "groq", "gemini"):
        assert OpenAICompatProvider(n, "k").name == n
