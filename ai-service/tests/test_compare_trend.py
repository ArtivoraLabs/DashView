"""odoo_compare / odoo_trend: period resolution, like-for-like baselines, movers, and the pure trend statistics."""
import json
from datetime import date

import httpx
import pytest

from app.cache import MemoryCache
from app.odoo.analytics import linear_fit, trend_summary
from app.odoo.client import OdooClient, OdooConfig
from app.odoo.dates import comparison_periods
from app.odoo.guard import Guard
from app.odoo.metrics import load_metrics
from app.odoo.tools import TOOL_INDEX, ToolContext, run_tool
from app.prompt import build_system_prompt
from tests.conftest import settings

TODAY = date(2026, 10, 12)  # a Monday


def test_this_month_is_compared_like_for_like():
    cur, prev, full = comparison_periods("this_month", None, None, TODAY)
    assert (cur.start, cur.end) == (date(2026, 10, 1), date(2026, 10, 13))
    assert (prev.start, prev.end) == (date(2026, 9, 1), date(2026, 9, 13))      # same 12 elapsed days
    assert (full.start, full.end) == (date(2026, 9, 1), date(2026, 10, 1))      # whole month kept as context


def test_like_for_like_can_be_switched_off():
    _, prev, full = comparison_periods("this_month", None, None, TODAY, like_for_like=False)
    assert (prev.start, prev.end) == (date(2026, 9, 1), date(2026, 10, 1)) and full is None


def test_whole_periods_compare_with_the_one_before():
    cur, prev, full = comparison_periods("last_month", None, None, TODAY)
    assert (prev.start, prev.end) == (date(2026, 8, 1), date(2026, 9, 1)) and full is None
    cur, prev, _ = comparison_periods("last_quarter", None, None, TODAY)
    assert (cur.start, prev.start) == (date(2026, 7, 1), date(2026, 4, 1))
    cur, prev, _ = comparison_periods("last_year", None, None, TODAY)
    assert (prev.start, prev.end) == (date(2024, 1, 1), date(2025, 1, 1))


def test_january_wraps_and_short_previous_month_is_capped():
    _, prev, _ = comparison_periods("last_month", None, None, date(2026, 1, 10))
    assert prev.start == date(2025, 11, 1)
    # 31 elapsed days of March compared with February (28 days): capped at the whole of February, nothing to add
    _, prev, full = comparison_periods("this_month", None, None, date(2026, 3, 31))
    assert (prev.start, prev.end) == (date(2026, 2, 1), date(2026, 3, 1)) and full is None


def test_custom_and_rolling_ranges_use_an_equally_long_range_before():
    cur, prev, _ = comparison_periods(None, "2026-09-10", "2026-09-19", TODAY)
    assert (prev.start, prev.end) == (date(2026, 8, 31), date(2026, 9, 10))
    cur, prev, _ = comparison_periods("last_7_days", None, None, TODAY)
    assert (cur.start, prev.start, prev.end) == (date(2026, 10, 6), date(2026, 9, 29), date(2026, 10, 6))


def test_all_time_cannot_be_compared():
    with pytest.raises(ValueError):
        comparison_periods("all_time", None, None, TODAY)


def test_linear_fit_recovers_a_perfect_line():
    f = linear_fit([10, 12, 14, 16, 18, 20])
    assert round(f.slope, 6) == 2 and round(f.intercept, 6) == 10 and round(f.r2, 6) == 1 and f.se == pytest.approx(0, abs=1e-9)
    assert linear_fit([1, 2]) is None


def series(values, in_progress_last=False):
    pts = [{"label": f"2026-{i + 1:02d}", "value": v, "complete": True} for i, v in enumerate(values)]
    if in_progress_last:
        pts[-1]["complete"] = False
    return pts


def test_trend_projection_and_in_progress_period_excluded():
    out = trend_summary(series([100, 110, 120, 130, 140, 150, 20], in_progress_last=True))
    assert out["complete_periods"] == 6 and out["latest_complete"]["value"] == 150     # the 20 is a half-finished month
    assert out["avg_period_change_pct"] == pytest.approx(((10 / 100) + (10 / 110) + (10 / 120) + (10 / 130) + (10 / 140)) / 5 * 100, abs=0.05)
    assert out["momentum"] == {"last_3_total": 420.0, "previous_3_total": 330.0, "change_pct": 27.27}
    proj = out["projection"]
    assert proj["next_periods"][0]["value"] == pytest.approx(160, abs=0.01) and proj["r_squared"] == 1
    assert "not data" in proj["caveat"].lower()


def test_noisy_or_short_history_is_not_projected():
    noisy = trend_summary(series([100, 5, 220, 10, 300, 20]))
    assert noisy["projection"] is None and "irregular" in noisy["projection_note"]
    short = trend_summary(series([100, 110, 120, 130]))
    assert short["projection"] is None and "6 complete periods" in short["projection_note"]
    assert "Not enough" in trend_summary(series([5]))["note"]


def make_ctx(totals):
    """Fake Odoo whose read_group totals depend on the date range in the domain."""
    def handler(request):
        body = json.loads(request.content)
        p = body["params"]
        svc, method, args = p["service"], p["method"], p["args"]
        if svc == "common":
            result = 7 if method == "authenticate" else {"server_version": "18.0"}
        else:
            _db, _uid, _key, model, m, a, kw = args
            if m == "read_group":
                domain, fields, groupby = a[0], a[1], a[2]
                start = next(t[2] for t in domain if t[1] == ">=")[:10]
                end = next(t[2] for t in domain if t[1] == "<")[:10]
                field = fields[0].split(":")[0]
                rows = totals(start, end, groupby)
                result = [{**({} if not groupby else {groupby[0]: [i, n]}), field: v, "__count": c} for i, (n, v, c) in enumerate(rows)] if groupby else \
                         [{field: sum(v for _, v, _ in rows), "__count": sum(c for *_, c in rows)}]
            elif model == "res.company":
                result = [{"id": 1, "currency_id": [3, "PKR"]}]
            else:
                result = []
        return httpx.Response(200, json={"jsonrpc": "2.0", "id": body["id"], "result": result})

    s = settings()
    http = httpx.AsyncClient(transport=httpx.MockTransport(handler))
    c = OdooClient(OdooConfig("https://x.odoo.com", "db", "u", "good-key"), http, MemoryCache(), s)
    return ToolContext(c, Guard(s), load_metrics(""), "UTC"), http


async def test_compare_reports_change_and_movers():
    def totals(start, end, groupby):
        # September-ish ranges vs October-ish ranges (dates in the domain are inclusive->exclusive)
        cur = start.startswith("2026-10")
        rows = [("Acme", 9000.0 if cur else 5000.0, 3), ("Globex", 1000.0 if cur else 4000.0, 2), ("Initech", 2000.0, 1)]
        return rows
    ctx, http = make_ctx(totals)
    r = await run_tool(ctx, "odoo_compare", {"metric": "sales_total", "period": "last_month", "groupby": "partner_id"})
    await http.aclose()
    assert "error" not in r, r
    # "today" here is the real clock, so only shape and arithmetic consistency are asserted (exact figures: next test)
    assert r["change"]["absolute"] == round(r["current"]["total"] - r["previous"]["total"], 2)
    assert set(r["movers"]) >= {"biggest_increases", "biggest_decreases"}
    assert r["previous"]["basis"].startswith("immediately preceding")


async def test_compare_arithmetic_and_movers_with_known_totals(monkeypatch):
    import app.odoo.tools as tools_mod
    monkeypatch.setattr(tools_mod, "local_today", lambda now, tz: date(2026, 10, 12))
    def totals(start, end, groupby):
        if start == "2026-10-01":                      # current: Oct 1-12
            return [("Acme", 9000.0, 3), ("Globex", 1000.0, 2), ("Initech", 2000.0, 1)]
        if start == "2026-09-01" and end == "2026-09-13":   # like-for-like: Sep 1-12
            return [("Acme", 5000.0, 2), ("Globex", 4000.0, 3), ("Initech", 2000.0, 1)]
        return [("Acme", 20000.0, 9), ("Globex", 9000.0, 6), ("Initech", 4000.0, 2)]   # whole of September
    ctx, http = make_ctx(totals)
    r = await run_tool(ctx, "odoo_compare", {"metric": "sales_total", "period": "this_month", "groupby": "partner_id"})
    await http.aclose()
    assert r["current"]["total"] == 12000.0 and r["previous"]["total"] == 11000.0
    assert r["previous"]["basis"].startswith("like-for-like")
    assert r["previous_full_period"]["total"] == 33000.0
    assert r["change"] == {"absolute": 1000.0, "percent": 9.09, "direction": "up"}
    assert r["movers"]["biggest_increases"][0]["group"] == "Acme" and r["movers"]["biggest_increases"][0]["change"] == 4000.0
    assert r["movers"]["biggest_decreases"][0] == {"group": "Globex", "current": 1000.0, "previous": 4000.0, "change": -3000.0, "change_percent": -75.0}
    assert "elapsed days" in r["note"]


async def test_compare_and_trend_refuse_point_in_time_metrics():
    ctx, http = make_ctx(lambda s, e, g: [("x", 1.0, 1)])
    for tool in ("odoo_compare", "odoo_trend"):
        r = await run_tool(ctx, tool, {"metric": "receivables_open"})
        assert "point-in-time" in r["error"]
    r = await run_tool(ctx, "odoo_compare", {"metric": "sales_total", "period": "all_time"})
    assert "all_time" in r["error"]
    await http.aclose()


async def test_trend_flags_the_current_month_and_projects(monkeypatch):
    import app.odoo.tools as tools_mod
    monkeypatch.setattr(tools_mod, "local_today", lambda now, tz: date(2026, 10, 12))
    def totals(start, end, groupby):
        idx = (int(start[:4]) - 2025) * 12 + int(start[5:7])          # 2025-11 -> 11 ... 2026-10 -> 22
        return [("all", 1000.0 + idx * 100.0 if not start.startswith("2026-10") else 50.0, 1)]
    ctx, http = make_ctx(totals)
    r = await run_tool(ctx, "odoo_trend", {"metric": "sales_total", "months": 12})
    await http.aclose()
    assert "error" not in r, r
    assert len(r["series"]) == 12 and r["series"][0]["label"] == "2025-11" and r["series"][-1]["label"] == "2026-10"
    assert r["series"][-1]["complete"] is False and all(p["complete"] for p in r["series"][:-1])
    s = r["summary"]
    assert s["complete_periods"] == 11 and s["latest_complete"]["label"] == "2026-09"
    assert s["projection"]["next_periods"][0]["value"] == pytest.approx(1000 + 22 * 100, abs=0.5)    # 2026-09 is idx 21, so the next period is idx 22


def test_new_tools_are_registered_and_in_the_prompt():
    assert {"odoo_compare", "odoo_trend"} <= set(TOOL_INDEX)
    prompt = build_system_prompt(load_metrics(""), "UTC")
    assert "COMPARISONS AND TRENDS" in prompt and "REPORT REQUESTS" in prompt and "odoo_trend" in prompt
