"""Model catalog + routing.

Tiers:  fast  -> cheap/quick lookups
        smart -> default for analysis
        deep  -> hardest multi-step reporting (opt-in, most expensive)

Model IDs change often. The defaults below are a starting point; override them
without code changes via MODEL_CATALOG_FILE (JSON list of
{"id","provider","tier"}), and double-check IDs in each vendor's docs.
"""
from __future__ import annotations

import json
import re
from dataclasses import dataclass

from ..config import Settings
from .anthropic_provider import AnthropicProvider
from .openai_compat import OpenAICompatProvider


@dataclass(frozen=True)
class ModelSpec:
    id: str
    provider: str
    tier: str  # fast | smart | deep


DEFAULT_CATALOG = [
    ModelSpec("claude-haiku-4-5-20251001", "anthropic", "fast"),
    ModelSpec("claude-sonnet-5", "anthropic", "smart"),
    ModelSpec("claude-opus-5-5", "anthropic", "deep"),
    ModelSpec("gpt-5.6-luna", "openai", "fast"),
    ModelSpec("gpt-5.6-terra", "openai", "smart"),
    ModelSpec("gpt-5.6-sol", "openai", "deep"),
    ModelSpec("grok-4-fast", "xai", "fast"),
    ModelSpec("openai/gpt-oss-120b", "groq", "fast"),
    ModelSpec("gemini-3.8-flash", "gemini", "fast"),
]
TIER_ORDER = ["fast", "smart", "deep"]

_ANALYTIC = re.compile(
    r"report|analy[sz]|compare|comparison|trend|forecast|why|breakdown|summary|summari[sz]e|"
    r"top \d+|rank|month|quarter|year|profit|margin|overdue|aging|tahlil|mukammal|puri|poora",
    re.I,
)


def load_catalog(settings: Settings) -> list[ModelSpec]:
    if settings.model_catalog_file:
        with open(settings.model_catalog_file, encoding="utf-8") as f:
            return [ModelSpec(**m) for m in json.load(f)]
    return DEFAULT_CATALOG


def build_providers(settings: Settings) -> dict:
    providers: dict = {}
    if settings.anthropic_api_key:
        providers["anthropic"] = AnthropicProvider(settings.anthropic_api_key)
    for name in ("openai", "xai", "groq", "gemini"):
        key = settings.provider_key(name)
        if key:
            providers[name] = OpenAICompatProvider(name, key)
    return providers


def pick_tier(question: str, requested: str, min_tier: str = "fast") -> str:
    if requested in TIER_ORDER:
        return requested
    q = question or ""
    picked = "smart" if (len(q) > 350 or _ANALYTIC.search(q)) else "fast"
    floor = min_tier if min_tier in TIER_ORDER else "fast"
    return max(picked, floor, key=TIER_ORDER.index)


def plan(catalog: list[ModelSpec], available: set[str], priority: list[str],
         question: str, tier: str = "auto", model: str | None = None, min_tier: str = "fast") -> list[ModelSpec]:
    """Ordered fail-over chain of usable models for this request."""
    usable = [m for m in catalog if m.provider in available]
    rank = {p: i for i, p in enumerate(priority)}
    usable.sort(key=lambda m: rank.get(m.provider, 99))
    chain: list[ModelSpec] = []
    if model:
        chain += [m for m in usable if m.id == model]
    want = pick_tier(question, tier, min_tier)
    # same tier first, then upward tiers (better answers), then cheaper ones
    order = [want] + [t for t in TIER_ORDER if TIER_ORDER.index(t) > TIER_ORDER.index(want)] + \
            [t for t in reversed(TIER_ORDER) if TIER_ORDER.index(t) < TIER_ORDER.index(want)]
    for t in order:
        chain += [m for m in usable if m.tier == t and m not in chain]
    return chain
