"""Accuracy evals: ask real questions, compare the answer with ground truth.

Ground truth is computed straight from Odoo with the same verified metrics
(no LLM involved), then we check the model's final answer contains the right
numbers / names. Run it after every prompt, metric or model change:

    python -m app.evals.run evals/golden.json [--tier smart] [--model claude-sonnet-5]

golden.json: [{"id": "...", "question": "...",
               "truth": {"metric": "sales_total", "period": "last_month", "groupby": "partner_id",
                         "limit": 3, "check": "total" | "top_groups"},
               "must_use": ["odoo_metric"], "must_contain": ["PKR"]}]
"""
from __future__ import annotations

import argparse
import asyncio
import json
import re
import sys

import httpx

from ..agent import stream_agent
from ..cache import build_cache
from ..config import get_settings
from ..llm.registry import build_providers, load_catalog, plan
from ..odoo.client import OdooClient, OdooConfig
from ..odoo.guard import Guard
from ..odoo.metrics import load_metrics, run_metric
from ..odoo.tools import ToolContext

MULT = {"k": 1e3, "m": 1e6, "mn": 1e6, "million": 1e6, "lakh": 1e5, "lac": 1e5, "crore": 1e7,
        "b": 1e9, "bn": 1e9, "billion": 1e9}
NUM_RE = re.compile(r"(?<![\w.])(\d[\d,]*(?:\.\d+)?)\s*(k|m|mn|million|lakh|lac|crore|bn|b|billion)?\b", re.I)


def extract_numbers(text: str) -> list[float]:
    out = []
    for raw, suffix in NUM_RE.findall(text):
        try:
            v = float(raw.replace(",", ""))
        except ValueError:
            continue
        out.append(v * MULT.get(suffix.lower(), 1) if suffix else v)
    return out


def number_present(target: float, numbers: list[float], rel: float = 0.005) -> bool:
    return any(abs(n - target) <= max(0.5, abs(target) * rel) for n in numbers)


def score(case: dict, truth: dict, answer: str, tools_used: list[str]) -> list[str]:
    """Returns a list of failure reasons (empty = pass)."""
    fails, nums = [], extract_numbers(answer)
    check = case["truth"].get("check", "total")
    if check in ("total", "top_groups") and not number_present(truth["total"], nums):
        fails.append(f"total {truth['total']} not found in answer")
    if check == "top_groups":
        for g in truth.get("groups", []):
            if str(g["group"]).lower() not in answer.lower():
                fails.append(f"group '{g['group']}' missing")
            elif not number_present(g["value"], nums):
                fails.append(f"value {g['value']} for '{g['group']}' not found")
    for t in case.get("must_use", []):
        if t not in tools_used:
            fails.append(f"tool {t} was not used")
    for s in case.get("must_contain", []):
        if s.lower() not in answer.lower():
            fails.append(f"answer lacks '{s}'")
    return fails


async def run(path: str, tier: str, model: str | None) -> int:
    s = get_settings()
    cfg = OdooConfig.from_settings(s)
    if cfg is None:
        sys.exit("Set ODOO_URL/DB/USERNAME/API_KEY first.")
    providers, catalog = build_providers(s), load_catalog(s)
    async with httpx.AsyncClient() as http:
        ctx = ToolContext(OdooClient(cfg, http, build_cache(""), s), Guard(s), load_metrics(s.metrics_file), s.timezone)
        cases = json.load(open(path, encoding="utf-8"))
        passed = 0
        for case in cases:
            t = case["truth"]
            truth = await run_metric(ctx, t["metric"], t.get("period"), t.get("start"), t.get("end"),
                                     t.get("groupby"), t.get("limit", 10))
            chain = plan(catalog, set(providers), s.priority, case["question"], tier, model, s.auto_min_tier)
            answer, tools = "", []
            async for ev in stream_agent(history=[{"role": "user", "content": case["question"]}], ctx=ctx,
                                         chain=chain, providers=providers, settings=s):
                if ev["type"] == "tool_start":
                    tools.append(ev["name"])
                elif ev["type"] == "final":
                    answer = ev["text"]
                elif ev["type"] == "error":
                    answer = "ERROR: " + ev["message"]
            fails = score(case, truth, answer, tools)
            passed += not fails
            print(f"[{'PASS' if not fails else 'FAIL'}] {case.get('id', case['question'][:40])}  tools={tools}")
            for f in fails:
                print("        -", f)
        print(f"\n{passed}/{len(cases)} passed")
        return 0 if passed == len(cases) else 1


if __name__ == "__main__":
    ap = argparse.ArgumentParser()
    ap.add_argument("golden")
    ap.add_argument("--tier", default="auto")
    ap.add_argument("--model")
    a = ap.parse_args()
    sys.exit(asyncio.run(run(a.golden, a.tier, a.model)))
