"""Verified KPI catalogue ("semantic layer").

Each metric pins down ONE business definition (model, states, date field,
measure, sign, currency basis) so the answer to "how much did we sell last
month?" is computed the same way every time instead of being re-invented by the
model. Override or add metrics with METRICS_FILE (JSON list, same keys as
below; the placeholder "$today" in a domain becomes the business-timezone date).
"""
from __future__ import annotations

import json
from dataclasses import dataclass, field
from datetime import datetime, timezone
from typing import Any

from .client import OdooError
from .dates import Period, custom_period, date_domain, local_today, resolve_period
from .guard import GuardError

DATE_UNITS = ("day", "week", "month", "quarter", "year")


@dataclass(frozen=True)
class Metric:
    key: str
    title: str
    definition: str
    model: str
    domain: list = field(default_factory=list)
    date_field: str | None = None
    date_kind: str = "datetime"          # 'date' | 'datetime'
    measure: str | None = None           # e.g. 'amount_total:sum'; None => record count
    abs_total: bool = False              # report magnitude (vendor-side signed fields)
    groupable: tuple = ()
    currency: str = "document"           # 'company' | 'document' | 'none'


_INV_OPEN = [["state", "=", "posted"], ["payment_state", "in", ["not_paid", "partial"]]]

DEFAULT_METRICS: dict[str, Metric] = {m.key: m for m in [
    Metric("sales_total", "Sales (incl. tax)",
           "Confirmed sales orders (state = sale/done), amount_total incl. tax, by order date. Excludes quotations and cancelled.",
           "sale.order", [["state", "in", ["sale", "done"]]], "date_order", "datetime", "amount_total:sum",
           groupable=("partner_id", "user_id", "team_id", "company_id")),
    Metric("sales_untaxed", "Sales (excl. tax)",
           "Confirmed sales orders (state = sale/done), amount_untaxed (before tax), by order date.",
           "sale.order", [["state", "in", ["sale", "done"]]], "date_order", "datetime", "amount_untaxed:sum",
           groupable=("partner_id", "user_id", "team_id", "company_id")),
    Metric("sales_by_product", "Sales by product line",
           "Order lines of confirmed sales orders, price_subtotal (excl. tax), by the order's date. Use groupby product_id for top products.",
           "sale.order.line", [["state", "in", ["sale", "done"]]], "order_id.date_order", "datetime", "price_subtotal:sum",
           groupable=("product_id", "order_partner_id", "salesman_id")),
    Metric("quotations_open", "Open quotations",
           "Sales orders still in draft/sent state (not confirmed), amount_total, by order date.",
           "sale.order", [["state", "in", ["draft", "sent"]]], "date_order", "datetime", "amount_total:sum",
           groupable=("partner_id", "user_id", "team_id")),
    Metric("invoiced_net", "Invoiced revenue (net of credit notes)",
           "Posted customer invoices minus credit notes, untaxed, in company currency, by invoice date.",
           "account.move", [["move_type", "in", ["out_invoice", "out_refund"]], ["state", "=", "posted"]],
           "invoice_date", "date", "amount_untaxed_signed:sum",
           groupable=("partner_id", "invoice_user_id", "journal_id", "company_id"), currency="company"),
    Metric("receivables_open", "Receivables outstanding",
           "Amount still owed by customers right now: posted customer invoices/credit notes not fully paid (not_paid/partial), company currency. Point-in-time; period is ignored.",
           "account.move", [["move_type", "in", ["out_invoice", "out_refund"]]] + _INV_OPEN,
           None, "date", "amount_residual_signed:sum", groupable=("partner_id", "invoice_user_id"), currency="company"),
    Metric("receivables_overdue", "Receivables overdue",
           "Part of receivables whose due date is before today (invoice_date_due < today). Point-in-time; period is ignored.",
           "account.move", [["move_type", "in", ["out_invoice", "out_refund"]]] + _INV_OPEN + [["invoice_date_due", "<", "$today"]],
           None, "date", "amount_residual_signed:sum", groupable=("partner_id", "invoice_user_id"), currency="company"),
    Metric("payables_open", "Payables outstanding",
           "Amount we still owe vendors: posted vendor bills (in_invoice) not fully paid, company currency, shown as a positive number. Vendor credit notes are not netted. Point-in-time.",
           "account.move", [["move_type", "=", "in_invoice"]] + _INV_OPEN,
           None, "date", "amount_residual_signed:sum", abs_total=True, groupable=("partner_id",), currency="company"),
    Metric("purchases_total", "Purchases",
           "Confirmed purchase orders (state = purchase/done), amount_total incl. tax, by order date.",
           "purchase.order", [["state", "in", ["purchase", "done"]]], "date_order", "datetime", "amount_total:sum",
           groupable=("partner_id", "user_id", "company_id")),
    Metric("crm_pipeline_open", "Open CRM pipeline",
           "Active opportunities not yet won (probability < 100; lost ones are archived), expected_revenue. Point-in-time.",
           "crm.lead", [["type", "=", "opportunity"], ["active", "=", True], ["probability", "<", 100]],
           None, "datetime", "expected_revenue:sum", groupable=("stage_id", "user_id", "team_id")),
    Metric("crm_won", "CRM won deals",
           "Opportunities with probability = 100, expected_revenue, by closing date (date_closed).",
           "crm.lead", [["type", "=", "opportunity"], ["active", "=", True], ["probability", "=", 100]],
           "date_closed", "datetime", "expected_revenue:sum", groupable=("user_id", "team_id", "stage_id")),
    Metric("stock_on_hand", "Stock on hand (units)",
           "Quantity in internal locations (stock.quant, location usage = internal). Point-in-time; units, not value.",
           "stock.quant", [["location_id.usage", "=", "internal"]], None, "datetime", "quantity:sum",
           groupable=("product_id", "location_id"), currency="none"),
    Metric("headcount", "Headcount",
           "Active employees (hr.employee, active = true). Point-in-time.",
           "hr.employee", [["active", "=", True]], None, "datetime", None,
           groupable=("department_id", "job_id", "company_id"), currency="none"),
    Metric("new_customers", "New customers",
           "Partners with customer_rank > 0, counted by creation date.",
           "res.partner", [["customer_rank", ">", 0]], "create_date", "datetime", None,
           groupable=("company_id",), currency="none"),
]}


def load_metrics(metrics_file: str = "") -> dict[str, Metric]:
    metrics = dict(DEFAULT_METRICS)
    if metrics_file:
        with open(metrics_file, encoding="utf-8") as f:
            for raw in json.load(f):
                raw["groupable"] = tuple(raw.get("groupable", ()))
                m = Metric(**raw)
                metrics[m.key] = m
    return metrics


def _subst(domain: list, today: str) -> list:
    return [[t[0], t[1], today] if isinstance(t, list) and t[2] == "$today" else t for t in domain]


def _pick(row: dict, key: str) -> Any:
    return row[key] if key in row else row.get(key.split(":")[0])


async def _company_currency(ctx) -> str | None:
    try:
        rows = await ctx.client.search_read("res.company", [], ["currency_id"], 1)
        v = rows[0]["currency_id"] if rows else None
        return v[1] if isinstance(v, list) and len(v) == 2 else None
    except OdooError:
        return None


def resolve_groupby(m: Metric, groupby: str | None) -> str | None:
    if not groupby:
        return None
    unit = groupby.split(":")[-1] if ":" in groupby else groupby
    if unit in DATE_UNITS:
        if not m.date_field or "." in m.date_field:
            raise GuardError(f"'{m.key}' can't be grouped by time; try one of: {', '.join(m.groupable) or 'none'}.")
        return f"{m.date_field}:{unit}"
    if groupby not in m.groupable:
        raise GuardError(f"'{m.key}' can be grouped by: {', '.join(m.groupable)}, or day/week/month/quarter/year.")
    return groupby


async def run_metric(ctx, key: str, period: str | None = None, start: str | None = None, end: str | None = None,
                     groupby: str | None = None, limit: int = 10, offset: int = 0) -> dict:
    m = ctx.metrics.get(key)
    if not m:
        raise GuardError(f"Unknown metric '{key}'. Available: {', '.join(ctx.metrics)}.")
    ctx.guard.check_model(m.model)
    now = datetime.now(timezone.utc)
    today = local_today(now, ctx.tz)
    try:
        p: Period = custom_period(start, end) if (start and end) else resolve_period(period or "this_month", today)
    except ValueError as e:
        raise GuardError(str(e))

    domain = _subst(m.domain, today.isoformat())
    dated = bool(m.date_field)
    if dated:
        domain = domain + date_domain(m.date_field, m.date_kind, p, ctx.tz)
    measure = m.measure or "__count"
    gb = resolve_groupby(m, groupby)
    limit = ctx.guard.check_limit(limit, default=10)
    offset = ctx.guard.check_offset(offset)

    grand = (await ctx.client.read_group(m.model, domain, [measure], []) or [{}])[0]

    def val(row):
        v = _pick(row, measure) if m.measure else row.get("__count", row.get("count", 0))
        v = float(v or 0)
        return abs(v) if m.abs_total else v

    out: dict = {
        "metric": key, "title": m.title, "definition": m.definition, "model": m.model,
        "period": p.describe() if dated else {"label": "as of now (period ignored)"},
        "filters_applied": domain,
        "records": grand.get("__count", grand.get("count", 0)),
        "total": round(val(grand), 2),
        "unit": "count" if not m.measure else ("quantity" if m.currency == "none" else "money"),
    }
    if m.currency == "company":
        out["currency"] = await _company_currency(ctx) or "company currency"
    elif m.currency == "document":
        out["currency"] = "each document's own currency (may mix if multi-currency)"
    if gb:
        order = None if ":" in gb else (f"{measure.split(':')[0]} desc" if m.measure else None)
        rows = await ctx.client.read_group(m.model, domain, [measure], [gb], order, limit + 1, offset)
        groups = []
        for r in rows[:limit]:
            label = r.get(gb, r.get(gb.split(":")[0]))
            if isinstance(label, list) and len(label) == 2:
                label = label[1]
            groups.append({"group": label if label is not False else "(none)", "value": round(val(r), 2),
                           "records": r.get("__count", r.get("count"))})
        out.update(groupby=gb, groups=groups)
        returned = len(groups)
        has_more = len(rows) > limit
        out.update(groups_offset=offset, groups_limit=limit, groups_returned=returned,
                   groups_has_more=has_more, groups_next_offset=offset + returned if has_more else None)
        if offset == 0 and has_more:
            out["note"] = f"Top {limit} groups shown; 'total' covers ALL records. More groups are available."
    return out
