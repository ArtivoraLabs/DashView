from __future__ import annotations

import json

from .base import LLMResult, ProviderError, ToolCall, ToolTurn


class AnthropicProvider:
    name = "anthropic"

    def __init__(self, api_key: str) -> None:
        from anthropic import AsyncAnthropic

        self._client = AsyncAnthropic(api_key=api_key, max_retries=2, timeout=120.0)

    @staticmethod
    def _messages(history: list[dict], turns: list[ToolTurn]) -> list[dict]:
        msgs = [{"role": m["role"], "content": m["content"]} for m in history]
        for t in turns:
            blocks: list[dict] = []
            if t.text:
                blocks.append({"type": "text", "text": t.text})
            blocks += [{"type": "tool_use", "id": c.id, "name": c.name, "input": c.args} for c in t.calls]
            msgs.append({"role": "assistant", "content": blocks})
            msgs.append({"role": "user", "content": [
                {"type": "tool_result", "tool_use_id": c.id, "content": out}
                for c, out in zip(t.calls, t.outputs)
            ]})
        return msgs

    async def complete(self, *, model, system, history, turns, tools, max_tokens, allow_tools=True) -> LLMResult:
        import anthropic

        kwargs = dict(
            model=model,
            max_tokens=max_tokens,
            # cache_control lets Anthropic reuse the (large, stable) system prompt + tools across calls
            system=[{"type": "text", "text": system, "cache_control": {"type": "ephemeral"}}],
            messages=self._messages(history, turns),
        )
        if tools:
            kwargs["tools"] = [{"name": t["name"], "description": t["description"], "input_schema": t["input_schema"]}
                               for t in tools]
            if not allow_tools:
                kwargs["tool_choice"] = {"type": "none"}
        try:
            resp = await self._client.messages.create(**kwargs)
        except anthropic.APIStatusError as e:
            raise ProviderError(f"Anthropic {e.status_code}: {getattr(e, 'message', e)}",
                                retryable=e.status_code in (408, 409, 429) or e.status_code >= 500)
        except anthropic.APIConnectionError as e:
            raise ProviderError(f"Anthropic connection error: {e}")
        text = "".join(b.text for b in resp.content if b.type == "text")
        calls = [ToolCall(b.id, b.name, dict(b.input or {})) for b in resp.content if b.type == "tool_use"]
        u = resp.usage
        usage = {"input_tokens": u.input_tokens, "output_tokens": u.output_tokens}
        return LLMResult(text=text, tool_calls=calls, usage=usage)
