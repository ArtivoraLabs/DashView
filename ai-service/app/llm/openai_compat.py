"""One adapter for every OpenAI-compatible chat-completions API:
OpenAI, xAI (Grok), Groq, Gemini's OpenAI-compat endpoint, OpenRouter, vLLM..."""
from __future__ import annotations

import json

from .base import LLMResult, ProviderError, ToolCall, ToolTurn

BASE_URLS = {
    "openai": None,
    "xai": "https://api.x.ai/v1",
    "groq": "https://api.groq.com/openai/v1",
    "gemini": "https://generativelanguage.googleapis.com/v1beta/openai/",
}
# OpenAI's newer models want max_completion_tokens; the others still take max_tokens.
TOKEN_PARAM = {"openai": "max_completion_tokens"}


class OpenAICompatProvider:
    def __init__(self, name: str, api_key: str, base_url: str | None = None) -> None:
        from openai import AsyncOpenAI

        self.name = name
        self._client = AsyncOpenAI(api_key=api_key, base_url=base_url or BASE_URLS.get(name),
                                   max_retries=2, timeout=120.0)

    @staticmethod
    def _messages(system: str, history: list[dict], turns: list[ToolTurn]) -> list[dict]:
        msgs: list[dict] = [{"role": "system", "content": system}]
        msgs += [{"role": m["role"], "content": m["content"]} for m in history]
        for t in turns:
            tcs = []
            for c in t.calls:
                tc = {"id": c.id, "type": "function", "function": {"name": c.name, "arguments": json.dumps(c.args)}}
                if c.extra:
                    tc["extra_content"] = c.extra
                tcs.append(tc)
            msgs.append({"role": "assistant", "content": t.text or None, "tool_calls": tcs})
            for c, out in zip(t.calls, t.outputs):
                msgs.append({"role": "tool", "tool_call_id": c.id, "content": out})
        return msgs

    async def complete(self, *, model, system, history, turns, tools, max_tokens, allow_tools=True) -> LLMResult:
        import openai

        kwargs: dict = dict(model=model, messages=self._messages(system, history, turns))
        kwargs[TOKEN_PARAM.get(self.name, "max_tokens")] = max_tokens
        if tools:
            kwargs["tools"] = [{"type": "function", "function": {
                "name": t["name"], "description": t["description"], "parameters": t["input_schema"]}} for t in tools]
            if not allow_tools:
                kwargs["tool_choice"] = "none"
        try:
            resp = await self._client.chat.completions.create(**kwargs)
        except openai.APIStatusError as e:
            raise ProviderError(f"{self.name} {e.status_code}: {getattr(e, 'message', e)}",
                                retryable=e.status_code in (408, 409, 429) or e.status_code >= 500)
        except openai.APIConnectionError as e:
            raise ProviderError(f"{self.name} connection error: {e}")
        msg = resp.choices[0].message
        calls = []
        for tc in msg.tool_calls or []:
            try:
                args = json.loads(tc.function.arguments or "{}")
            except ValueError:
                args = {}
            extra = (getattr(tc, "model_extra", None) or {}).get("extra_content")
            calls.append(ToolCall(tc.id, tc.function.name, args if isinstance(args, dict) else {}, extra))
        u = resp.usage
        usage = {"input_tokens": getattr(u, "prompt_tokens", 0), "output_tokens": getattr(u, "completion_tokens", 0)} if u else {}
        return LLMResult(text=msg.content or "", tool_calls=calls, usage=usage)
