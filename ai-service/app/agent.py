"""The agent loop: LLM <-> Odoo tools, with model fail-over.

Yields events (dicts) so the API layer can stream progress over SSE or just
collect the final answer for plain JSON clients.
"""
from __future__ import annotations

import asyncio
import json
import logging
from typing import AsyncIterator

from .config import Settings
from .llm.base import ProviderError, ToolTurn
from .llm.registry import ModelSpec
from .odoo.tools import TOOLS, ToolContext, run_tool
from .prompt import build_system_prompt

log = logging.getLogger("agent")

def _summarize(result: dict) -> str:
    if "error" in result:
        return "error: " + str(result["error"])[:160]
    if "total" in result and "metric" in result:
        return f"{result['metric']}: total {result['total']} ({result.get('records', '?')} records)"
    for key in ("rows", "groups", "models", "fields", "apps"):
        if key in result:
            n = len(result[key])
            return f"{n} {key}" + (f" of {result['total_matching']}" if "total_matching" in result else "")
    if "count" in result:
        return f"count = {result['count']}"
    if "metrics" in result:
        return f"{len(result['metrics'])} metrics"
    return "ok"


async def stream_agent(*, history: list[dict], ctx: ToolContext, chain: list[ModelSpec], providers: dict,
                       settings: Settings) -> AsyncIterator[dict]:
    if not chain:
        yield {"type": "error", "message": "No AI provider is configured on the server (set an API key)."}
        return

    system = build_system_prompt(ctx.metrics, ctx.tz)
    tools = [{"name": t.name, "description": t.description, "input_schema": t.input_schema} for t in TOOLS]
    turns: list[ToolTurn] = []
    usage = {"input_tokens": 0, "output_tokens": 0}
    tool_calls_made = 0
    last_error = ""

    async def complete(allow_tools: bool):
        nonlocal last_error
        sys_prompt = system if allow_tools else system + (
            "\n\nTool budget exhausted: answer now using only the data already retrieved, "
            "and state clearly what is missing.")
        for spec in chain:
            try:
                res = await providers[spec.provider].complete(
                    model=spec.id, system=sys_prompt, history=history, turns=turns,
                    tools=tools, allow_tools=allow_tools, max_tokens=settings.max_output_tokens)
                return spec, res
            except ProviderError as e:
                last_error = str(e)
                log.warning("model %s failed: %s", spec.id, e)
                continue
            except Exception as e:  # noqa: BLE001 - vendor SDK surprises must not kill the stream
                last_error = f"{type(e).__name__}: {e}"
                log.exception("model %s crashed", spec.id)
                continue
        return None, None

    for hop in range(settings.max_tool_hops + 1):
        final_pass = hop == settings.max_tool_hops
        spec, res = await complete(allow_tools=not final_pass)
        if res is None:
            yield {"type": "error", "message": "All AI models failed: " + last_error[:300]}
            return
        for k in usage:
            usage[k] += res.usage.get(k, 0)
        if hop == 0 or res.tool_calls:
            yield {"type": "model", "model": spec.id, "provider": spec.provider}

        if not res.tool_calls:
            yield {"type": "final", "text": res.text.strip(), "model": spec.id, "provider": spec.provider,
                   "usage": usage, "tool_calls": tool_calls_made}
            return

        for c in res.tool_calls:
            yield {"type": "tool_start", "id": c.id, "name": c.name, "args": c.args}

        async def run(c):
            try:
                return await asyncio.wait_for(run_tool(ctx, c.name, c.args), settings.tool_timeout_s)
            except asyncio.TimeoutError:
                return {"error": "Tool timed out; try a narrower query."}

        results = await asyncio.gather(*(run(c) for c in res.tool_calls))
        outputs = []
        for c, r in zip(res.tool_calls, results):
            tool_calls_made += 1
            outputs.append(json.dumps(r, default=str))
            yield {"type": "tool_result", "id": c.id, "name": c.name, "summary": _summarize(r)}
        turns.append(ToolTurn(res.text, res.tool_calls, outputs))


    yield {"type": "error", "message": "The assistant could not finish within its tool budget."}
