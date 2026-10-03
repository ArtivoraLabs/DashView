"""Read-only guardrails between the LLM and Odoo.

The model never gets a raw RPC channel. Every tool call passes through here:
model allow/deny lists, field-name screening, and strict validation of
domains / group-by / measures / ordering so a prompt-injected or confused
model can't reach credentials, security models or huge unbounded queries.
"""
from __future__ import annotations

import re
from typing import Any

from ..config import Settings, _csv


class GuardError(ValueError):
    """Raised for anything the assistant is not allowed to ask Odoo."""


MODEL_RE = re.compile(r"^[a-z][a-z0-9_]*(\.[a-z0-9_]+)+$")
FIELD_PATH_RE = re.compile(r"^[a-z_][a-z0-9_]*(\.[a-z_][a-z0-9_]*){0,3}$")
GROUPBY_RE = re.compile(r"^[a-z_][a-z0-9_]*(\.[a-z_][a-z0-9_]*)?(:(day|week|month|quarter|year))?$")
MEASURE_RE = re.compile(r"^([a-z_][a-z0-9_]*):(sum|avg|min|max|count|count_distinct)$|^__count$")
ORDER_RE = re.compile(
    r"^[a-z_][a-z0-9_]*(:[a-z_]+)?( (asc|desc))?(,\s*[a-z_][a-z0-9_]*(:[a-z_]+)?( (asc|desc))?)*$", re.I
)

OPERATORS = {
    "=", "!=", ">", ">=", "<", "<=", "like", "not like", "ilike", "not ilike",
    "=like", "=ilike", "in", "not in", "child_of", "parent_of", "=?",
}
LOGIC = {"&", "|", "!"}

# Fragments that mark a field as secret-bearing, whatever the model calls it.
SENSITIVE_FIELD_PARTS = (
    "password", "passwd", "api_key", "apikey", "secret", "token", "oauth",
    "private_key", "totp", "otp_", "credential", "signature",
)
# Security / infrastructure models: never readable through the assistant.
BLOCKED_MODEL_PREFIXES = (
    "ir.", "base.", "bus.", "auth", "res.users", "res.config", "res.device",
    "mail.mail", "mail.message", "mail.notification", "payment.", "fetchmail.",
)
BLOCKED_MODELS = {"res.users", "res.company.ldap", "queue.job"}

MAX_DOMAIN_TERMS = 30
MAX_FIELDS = 40
MAX_OFFSET = 100_000


class Guard:
    def __init__(self, settings: Settings) -> None:
        self.max_rows = settings.max_rows
        self.allowed = set(_csv(settings.odoo_allowed_models))
        self.extra_blocked = set(_csv(settings.odoo_blocked_models))
        self.extra_field_parts = tuple(p.lower() for p in _csv(settings.odoo_blocked_fields))

    # ── models & fields ──────────────────────────────────────────────
    def model_allowed(self, model: str) -> bool:
        if not isinstance(model, str) or not MODEL_RE.match(model):
            return False
        if self.allowed:
            return model in self.allowed
        if model in BLOCKED_MODELS or model in self.extra_blocked:
            return False
        return not model.startswith(BLOCKED_MODEL_PREFIXES)

    def check_model(self, model: str) -> str:
        if not self.model_allowed(model):
            raise GuardError(f"Model '{model}' is not available to the assistant.")
        return model

    def field_sensitive(self, name: str) -> bool:
        n = name.lower()
        return any(p in n for p in SENSITIVE_FIELD_PARTS + self.extra_field_parts)

    def check_field_path(self, path: Any) -> str:
        if not isinstance(path, str) or not FIELD_PATH_RE.match(path):
            raise GuardError(f"Invalid field name: {path!r}")
        if any(self.field_sensitive(seg) for seg in path.split(".")):
            raise GuardError(f"Field '{path}' is not available to the assistant.")
        return path

    def check_fields(self, fields: Any) -> list[str]:
        if fields in (None, []):
            return []
        if not isinstance(fields, list) or len(fields) > MAX_FIELDS:
            raise GuardError(f"fields must be a list of at most {MAX_FIELDS} field names.")
        return [self.check_field_path(f) for f in fields]

    # ── domains ──────────────────────────────────────────────────────
    def check_domain(self, domain: Any) -> list:
        if domain in (None, []):
            return []
        if not isinstance(domain, list) or len(domain) > MAX_DOMAIN_TERMS:
            raise GuardError(f"domain must be a list of at most {MAX_DOMAIN_TERMS} terms.")
        out: list = []
        for term in domain:
            if isinstance(term, str):
                if term not in LOGIC:
                    raise GuardError(f"Invalid domain operator: {term!r}")
                out.append(term)
                continue
            if not (isinstance(term, (list, tuple)) and len(term) == 3):
                raise GuardError("Each domain term must be [field, operator, value].")
            field, op, value = term
            self.check_field_path(field)
            if op not in OPERATORS:
                raise GuardError(f"Unsupported domain operator: {op!r}")
            self._check_value(value, allow_list=op in ("in", "not in", "child_of", "parent_of"))
            out.append([field, op, value])
        return out

    def _check_value(self, value: Any, allow_list: bool) -> None:
        scalar = (type(None), bool, int, float)
        if isinstance(value, scalar):
            return
        if isinstance(value, str):
            if len(value) > 200:
                raise GuardError("Domain value too long.")
            return
        if allow_list and isinstance(value, list) and len(value) <= 200:
            for v in value:
                self._check_value(v, allow_list=False)
            return
        raise GuardError("Unsupported domain value.")

    # ── limits / grouping / ordering ─────────────────────────────────
    def check_limit(self, limit: Any, default: int = 25) -> int:
        try:
            n = int(limit) if limit is not None else default
        except (TypeError, ValueError):
            raise GuardError("limit must be an integer.")
        return max(1, min(n, self.max_rows))

    def check_offset(self, offset: Any) -> int:
        if isinstance(offset, bool):
            raise GuardError("offset must be a non-negative integer.")
        try:
            n = int(offset) if offset is not None else 0
        except (TypeError, ValueError):
            raise GuardError("offset must be a non-negative integer.")
        if n < 0 or n > MAX_OFFSET or str(n) != str(offset if offset is not None else 0):
            raise GuardError(f"offset must be between 0 and {MAX_OFFSET}.")
        return n

    def check_order(self, order: Any) -> str | None:
        if not order:
            return None
        if not isinstance(order, str) or len(order) > 120 or not ORDER_RE.match(order.strip()):
            raise GuardError("Invalid order clause. Use e.g. 'amount_total desc'.")
        return order.strip()

    def check_groupby(self, groupby: Any) -> list[str]:
        if not isinstance(groupby, list) or not (0 < len(groupby) <= 3):
            raise GuardError("groupby must be a list of 1-3 fields (e.g. ['partner_id', 'date_order:month']).")
        for g in groupby:
            if not isinstance(g, str) or not GROUPBY_RE.match(g):
                raise GuardError(f"Invalid groupby: {g!r}")
            self.check_field_path(g.split(":")[0])
        return groupby

    def check_measures(self, measures: Any) -> list[str]:
        if measures in (None, []):
            return ["__count"]
        if not isinstance(measures, list) or len(measures) > 6:
            raise GuardError("measures must be a list of at most 6 items like 'amount_total:sum'.")
        for m in measures:
            if not isinstance(m, str) or not MEASURE_RE.match(m):
                raise GuardError(f"Invalid measure {m!r}. Use 'field:sum|avg|min|max|count|count_distinct' or '__count'.")
            if m != "__count":
                self.check_field_path(m.split(":")[0])
        return measures
