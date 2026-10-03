"""Provider-neutral types. The agent keeps the conversation in a neutral form
(history + ToolTurns) and each provider renders it into its own wire format,
so a failed model can be swapped for another one at any point in a run."""
from __future__ import annotations

from dataclasses import dataclass, field
from typing import Any, Protocol


@dataclass
class ToolCall:
    id: str
    name: str
    args: dict
    extra: Any = None  # provider-specific passthrough (e.g. Gemini thought signatures)


@dataclass
class ToolTurn:
    text: str
    calls: list[ToolCall]
    outputs: list[str]  # JSON strings, aligned with calls


@dataclass
class LLMResult:
    text: str
    tool_calls: list[ToolCall] = field(default_factory=list)
    usage: dict = field(default_factory=dict)


class Provider(Protocol):
    name: str

    async def complete(self, *, model: str, system: str, history: list[dict], turns: list[ToolTurn],
                       tools: list[dict], max_tokens: int, allow_tools: bool = True) -> LLMResult: ...


class ProviderError(Exception):
    """Wraps vendor SDK errors so the agent can decide whether to fail over."""

    def __init__(self, message: str, retryable: bool = True) -> None:
        super().__init__(message)
        self.retryable = retryable
