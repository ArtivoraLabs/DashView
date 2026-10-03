from datetime import date, datetime, timezone

import httpx
import pytest

from app.cache import MemoryCache
from app.odoo.client import OdooClient, OdooConfig
from app.odoo.dates import custom_period, date_domain, resolve_period
from app.odoo.guard import Guard, GuardError
from app.odoo.metrics import load_metrics, run_metric
from app.odoo.tools import ToolContext, run_tool
from app.prompt import build_system_prompt
from tests.conftest import fake_odoo_transport, settings

TODAY = date(2026, 9, 24)  # a Thursday


@pytest.mark.parametrize("name,start,end", [
    ("today", "2026-09-24", "2026-09-25"),
    ("this_week", "2026-09-21", "2026-09-25"),
    ("last_week", "2026-09-14", "2026-09-21"),
    ("this_month", "2026-09-01", "2026-09-25"),
    ("last_month", "2026-08-01", "2026-09-01"),
    ("this_quarter", "2026-07-01", "2026-09-25"),
    ("last_quarter", "2026-04-01", "2026-07-01"),
    ("last_year", "2025-01-01", "2026-01-01"),
    ("last_7_days", "2026-09-18", "2026-09-25"),
])
def test_periods(name, start, end):
    p = resolve_period(name, TODAY)
    assert (p.start.isoformat(), p.end.isoformat()) == (start, end)


def test_january_last_month_wraps_year():
    p = resolve_period("last_month", date(2026, 1, 10))
    assert (p.start, p.end) == (date(2025, 12, 1), date(2026, 1, 1))


def test_datetime_domain_uses_business_timezone():
    p = custom_period("2026-09-01", "2026-09-30")
    d = date_domain("date_order", "datetime", p, "Asia/Karachi")  # UTC+5
    assert d == [["date_order", ">=", "2026-08-31 19:00:00"], ["date_order", "<", "2026-09-30 19:00:00"]]
    assert date_domain("invoice_date", "date", p, "UTC")[0] == ["invoice_date", ">=", "2026-09-01"]
    assert date_domain("x", "date", resolve_period("all_time", TODAY), "UTC") == []


def ctx():
    s = settings()
    http = httpx.AsyncClient(transport=fake_odoo_transport())
    c = OdooClient(OdooConfig("https://x.odoo.com", "db", "u", "good-key"), http, MemoryCache(), s)
    return ToolContext(c, Guard(s), load_metrics(""), "Asia/Karachi"), http


async def test_metric_total_and_groups():
    c, http = ctx()
    r = await run_metric(c, "sales_total", "last_month", groupby="partner_id", limit=5)
    assert r["total"] == 8000.0 and r["records"] == 6
    assert r["groups"][0] == {"group": "Acme", "value": 5000.0, "records": 4}
    assert r["period"]["from"] and r["filters_applied"][0] == ["state", "in", ["sale", "done"]]
    await http.aclose()


async def test_point_in_time_metric_ignores_period_and_substitutes_today():
    c, http = ctx()
    r = await run_metric(c, "receivables_overdue", "last_year")
    assert r["period"]["label"].startswith("as of now") and r["currency"] == "PKR"
    due = [t for t in r["filters_applied"] if t[0] == "invoice_date_due"][0]
    assert due[2] != "$today" and len(due[2]) == 10
    await http.aclose()


async def test_vendor_payables_reported_positive():
    c, http = ctx()
    c.client._s = settings()
    r = await run_metric(c, "payables_open")
    assert r["total"] > 0
    await http.aclose()


async def test_metric_errors_are_guided():
    c, http = ctx()
    for bad in [dict(key="nope"), dict(key="sales_total", groupby="password"), dict(key="sales_total", period="next_decade"),
                dict(key="headcount", groupby="month")]:
        with pytest.raises(GuardError):
            await run_metric(c, **bad)
    out = await run_tool(c, "odoo_metric", {"metric": "sales_total", "groupby": "nonsense"})
    assert "can be grouped by" in out["error"]
    await http.aclose()


async def test_time_groupby_maps_to_date_field():
    c, http = ctx()
    r = await run_metric(c, "sales_total", "this_year", groupby="month")
    assert r["groupby"] == "date_order:month"
    await http.aclose()


async def test_metric_group_pagination_keeps_all_record_total():
    c, http = ctx()
    r = await run_metric(c, "sales_total", "last_month", groupby="partner_id", limit=1)
    assert r["records"] == 6 and r["total"] == 8000.0
    assert r["groups_returned"] == 1 and r["groups_has_more"] is True
    assert r["groups_next_offset"] == 1
    await http.aclose()


def test_custom_metrics_override(tmp_path):
    f = tmp_path / "m.json"
    f.write_text('[{"key":"sales_total","title":"Sales (invoiced)","definition":"our own","model":"account.move",'
                 '"domain":[["move_type","=","out_invoice"]],"measure":"amount_total_signed:sum","currency":"company"},'
                 '{"key":"vip","title":"VIP","definition":"d","model":"res.partner","domain":[["x_vip","=",true]]}]')
    m = load_metrics(str(f))
    assert m["sales_total"].definition == "our own" and "vip" in m and "invoiced_net" in m


def test_prompt_contains_resolved_dates_and_metrics():
    p = build_system_prompt(load_metrics(""), "Asia/Karachi", datetime(2026, 9, 24, 8, tzinfo=timezone.utc))
    assert "Thursday, 24 September 2026" in p and "last_month: 2026-08-01 to 2026-08-31" in p
    assert "sales_total" in p and "receivables_overdue" in p
