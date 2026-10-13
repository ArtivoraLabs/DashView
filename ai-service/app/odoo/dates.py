"""Deterministic period maths. The model never computes date ranges itself:
'this month', 'last quarter', ... are resolved here in the business timezone
and converted to the UTC strings Odoo stores for datetime fields."""
from __future__ import annotations

from dataclasses import dataclass
from datetime import date, datetime, time, timedelta, timezone
from zoneinfo import ZoneInfo

PERIODS = ("today", "yesterday", "this_week", "last_week", "this_month", "last_month",
           "this_quarter", "last_quarter", "this_year", "last_year",
           "last_7_days", "last_30_days", "last_90_days", "all_time")


@dataclass(frozen=True)
class Period:
    label: str
    start: date | None      # inclusive
    end: date | None        # exclusive

    @property
    def last_day(self) -> date | None:
        return self.end - timedelta(days=1) if self.end else None

    def describe(self) -> dict:
        return {"label": self.label,
                "from": self.start.isoformat() if self.start else None,
                "to": self.last_day.isoformat() if self.end else None}


def local_today(now_utc: datetime, tz: str) -> date:
    return now_utc.astimezone(ZoneInfo(tz)).date()


def _add_months(d: date, n: int) -> date:
    y, m = divmod(d.year * 12 + d.month - 1 + n, 12)
    return date(y, m + 1, 1)


def resolve_period(name: str, today: date) -> Period:
    if name == "all_time":
        return Period("all time", None, None)
    tomorrow = today + timedelta(days=1)
    if name == "today":
        return Period("today", today, tomorrow)
    if name == "yesterday":
        return Period("yesterday", today - timedelta(days=1), today)
    if name in ("this_week", "last_week"):
        mon = today - timedelta(days=today.weekday())
        if name == "last_week":
            return Period("last week (Mon-Sun)", mon - timedelta(days=7), mon)
        return Period("this week (Mon-today)", mon, tomorrow)
    if name in ("this_month", "last_month"):
        first = today.replace(day=1)
        if name == "last_month":
            return Period("last month", _add_months(first, -1), first)
        return Period("this month (1st-today)", first, tomorrow)
    if name in ("this_quarter", "last_quarter"):
        q = today.replace(month=3 * ((today.month - 1) // 3) + 1, day=1)
        if name == "last_quarter":
            return Period("last quarter", _add_months(q, -3), q)
        return Period("this quarter (so far)", q, tomorrow)
    if name in ("this_year", "last_year"):
        first = date(today.year, 1, 1)
        if name == "last_year":
            return Period("last year", date(today.year - 1, 1, 1), first)
        return Period("this year (Jan 1-today)", first, tomorrow)
    if name.startswith("last_") and name.endswith("_days"):
        n = int(name.split("_")[1])
        return Period(f"last {n} days (incl. today)", today - timedelta(days=n - 1), tomorrow)
    raise ValueError(f"Unknown period '{name}'. Use one of: {', '.join(PERIODS)}.")


def custom_period(start: str, end: str) -> Period:
    """Inclusive YYYY-MM-DD dates."""
    s, e = date.fromisoformat(start), date.fromisoformat(end)
    if e < s:
        raise ValueError("end must not be before start.")
    return Period(f"{start} to {end}", s, e + timedelta(days=1))


def date_domain(field: str, kind: str, p: Period, tz: str) -> list:
    """Domain terms restricting `field` to the period. kind: 'date' | 'datetime'."""
    if p.start is None:
        return []
    if kind == "date":
        return [[field, ">=", p.start.isoformat()], [field, "<", p.end.isoformat()]]
    zone = ZoneInfo(tz)

    def utc(d: date) -> str:
        return datetime.combine(d, time.min, zone).astimezone(timezone.utc).strftime("%Y-%m-%d %H:%M:%S")

    return [[field, ">=", utc(p.start)], [field, "<", utc(p.end)]]


def _prev_month_start(first: date, n: int = 1) -> date:
    return _add_months(first, -n)


def comparison_periods(name: str | None, start: str | None, end: str | None, today: date,
                       like_for_like: bool = True) -> tuple[Period, Period, Period | None]:
    """Resolve (current, previous, previous_full) for a period-over-period comparison.

    Comparing "this month so far" with the whole of last month always makes growth look negative, so for to-date
    periods (this_week / this_month / this_quarter / this_year) `previous` covers the SAME number of elapsed days of
    the preceding period and `previous_full` is the complete preceding period (None when they are identical).
    Whole past periods are compared with the period immediately before them; custom ranges and last_N_days with the
    equally long range right before them. Never done by the model: it only receives the resolved ranges.
    """
    if start and end:
        cur = custom_period(start, end)
        span = cur.end - cur.start
        prev = Period(f"{(cur.start - span).isoformat()} to {(cur.start - timedelta(days=1)).isoformat()}", cur.start - span, cur.start)
        return cur, prev, None
    name = name or "this_month"
    if name == "all_time":
        raise ValueError("all_time has no previous period to compare with; choose a bounded period.")
    cur = resolve_period(name, today)

    def whole(prev_start: date, prev_end: date, label: str) -> Period:
        return Period(label, prev_start, prev_end)

    if name in ("today", "yesterday"):
        d = cur.start
        return cur, whole(d - timedelta(days=1), d, "the day before"), None
    if name.startswith("last_") and name.endswith("_days"):
        n = int(name.split("_")[1])
        return cur, whole(cur.start - timedelta(days=n), cur.start, f"the {n} days before"), None

    if name in ("this_week", "last_week"):
        full = whole(cur.start - timedelta(days=7), cur.start, "the previous week (Mon-Sun)")
    elif name in ("this_month", "last_month"):
        full = whole(_prev_month_start(cur.start), cur.start, "the previous month")
    elif name in ("this_quarter", "last_quarter"):
        full = whole(_prev_month_start(cur.start, 3), cur.start, "the previous quarter")
    elif name in ("this_year", "last_year"):
        full = whole(date(cur.start.year - 1, 1, 1), cur.start, "the previous year")
    else:
        raise ValueError(f"Cannot compare period '{name}'.")

    if name.startswith("this_") and like_for_like:
        elapsed = cur.end - cur.start
        prev_end = min(full.start + elapsed, full.end)
        if prev_end < full.end:
            like = Period(f"{full.label}, same {elapsed.days} elapsed day(s)", full.start, prev_end)
            return cur, like, full
    return cur, full, None
