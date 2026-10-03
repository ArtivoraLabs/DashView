"""Append-only JSONL audit trail: question -> tools (with args) -> answer -> feedback.
This is the raw material for improving accuracy: filter thumbs-down / wrong answers,
see exactly which tool calls produced them, then fix a metric definition or prompt rule
and add the question to evals/golden.json."""
from __future__ import annotations

import asyncio
import json
import os
import time


class Audit:
    def __init__(self, path: str) -> None:
        self.path = path
        if path:
            os.makedirs(os.path.dirname(os.path.abspath(path)), exist_ok=True)

    def _write(self, rec: dict) -> None:
        with open(self.path, "a", encoding="utf-8") as f:
            f.write(json.dumps(rec, ensure_ascii=False, default=str) + "\n")

    async def record(self, rec: dict) -> None:
        if self.path:
            await asyncio.to_thread(self._write, {"ts": round(time.time(), 3), **rec})
