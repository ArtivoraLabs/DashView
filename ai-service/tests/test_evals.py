from app.evals.run import extract_numbers, number_present, score

CASE = {"truth": {"check": "top_groups"}, "must_use": ["odoo_metric"]}
TRUTH = {"total": 8000.0, "groups": [{"group": "Acme", "value": 5000.0}, {"group": "Globex", "value": 3000.0}]}


def test_number_extraction_formats():
    assert 12_384_201 in extract_numbers("Total: 12,384,201.00 PKR")
    assert number_present(12_400_000, extract_numbers("about 12.4M"))
    assert number_present(2_500_000, extract_numbers("25 lakh"))
    assert not number_present(8000, extract_numbers("we sold 9,000"))


def test_score_pass_and_fail():
    good = "Total 8,000. Acme: 5,000, Globex: 3,000."
    assert score(CASE, TRUTH, good, ["odoo_metric"]) == []
    bad = score(CASE, TRUTH, "Total 9,100. Acme: 5,000.", ["odoo_search_read"])
    assert any("total" in f for f in bad) and any("Globex" in f for f in bad) and any("odoo_metric" in f for f in bad)
