import pytest

from app.odoo.guard import Guard, GuardError
from tests.conftest import settings

g = Guard(settings())


@pytest.mark.parametrize("m", ["res.users", "ir.config_parameter", "ir.attachment", "res.users.apikeys",
                               "mail.message", "payment.token", "not a model", "sale.order; drop"])
def test_blocked_models(m):
    with pytest.raises(GuardError):
        g.check_model(m)


@pytest.mark.parametrize("m", ["sale.order", "account.move", "res.partner", "hr.employee"])
def test_allowed_models(m):
    assert g.check_model(m) == m


def test_allowlist_overrides():
    gg = Guard(settings(odoo_allowed_models="sale.order"))
    assert gg.model_allowed("sale.order") and not gg.model_allowed("res.partner")


def test_extra_blocked_and_fields():
    gg = Guard(settings(odoo_blocked_models="hr.payslip", odoo_blocked_fields="wage"))
    assert not gg.model_allowed("hr.payslip")
    with pytest.raises(GuardError):
        gg.check_fields(["name", "wage"])


def test_domain_ok_and_bad():
    assert g.check_domain([["state", "=", "sale"], "|", ["amount_total", ">", 10], ["partner_id.name", "ilike", "a"]])
    for bad in ([["state", "=~", "x"]], [["password", "=", "x"]], [["a b", "=", 1]], [["x", "=", {"a": 1}]],
                ["&&"], [["state", "="]], "state=sale"):
        with pytest.raises(GuardError):
            g.check_domain(bad)


def test_groupby_measures_order_limit():
    assert g.check_groupby(["partner_id", "date_order:month"])
    assert g.check_measures(["amount_total:sum", "__count"])
    assert g.check_order("amount_total desc")
    assert g.check_limit(10_000) == g.max_rows
    for fn, arg in [(g.check_groupby, ["x;y"]), (g.check_measures, ["amount_total:exec"]),
                    (g.check_order, "1; drop table"), (g.check_groupby, [])]:
        with pytest.raises(GuardError):
            fn(arg)


def test_offset_is_nonnegative_and_bounded():
    assert g.check_offset(None) == 0
    assert g.check_offset(100_000) == 100_000
    for offset in (-1, 100_001, 1.5, True, "not-an-offset"):
        with pytest.raises(GuardError):
            g.check_offset(offset)


def test_operational_limits_are_validated():
    from pydantic import ValidationError

    with pytest.raises(ValidationError):
        settings(max_rows=1001)
    with pytest.raises(ValidationError):
        settings(max_chat_concurrency=0)
