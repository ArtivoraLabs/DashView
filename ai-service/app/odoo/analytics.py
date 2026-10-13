"""Small, dependency-free statistics for trend questions. Pure functions: they take a list of period totals and return
numbers, so the model never does arithmetic (or invents a projection) on its own. Everything here is deterministic and
unit-tested without Odoo."""
from __future__ import annotations

import math
from dataclasses import dataclass


@dataclass(frozen=True)
class Fit:
    slope: float
    intercept: float
    r2: float
    se: float          # standard error of the residuals (n-2 degrees of freedom)
    n: int


def linear_fit(ys: list[float]) -> Fit | None:
    n = len(ys)
    if n < 3:
        return None
    sx = n * (n - 1) / 2
    sxx = (n - 1) * n * (2 * n - 1) / 6
    sy = sum(ys)
    sxy = sum(i * y for i, y in enumerate(ys))
    den = n * sxx - sx * sx
    if den == 0:
        return None
    slope = (n * sxy - sx * sy) / den
    icpt = (sy - slope * sx) / n
    mean = sy / n
    ss_tot = sum((y - mean) ** 2 for y in ys)
    ss_res = sum((y - (icpt + slope * i)) ** 2 for i, y in enumerate(ys))
    return Fit(slope, icpt, (1 - ss_res / ss_tot) if ss_tot else 0.0, math.sqrt(ss_res / (n - 2)), n)


def _pct(new: float, old: float) -> float | None:
    return None if old == 0 else round((new - old) / abs(old) * 100, 2)


def trend_summary(points: list[dict], horizon: int = 3) -> dict:
    """points: oldest -> newest, each {"label", "value", "complete": bool}. A period still in progress is reported but
    excluded from every statistic and from the projection, so a half-finished month never reads as a collapse."""
    done = [p for p in points if p.get("complete", True)]
    vals = [float(p["value"]) for p in done]
    out: dict = {"periods": len(points), "complete_periods": len(done)}
    if len(vals) < 2:
        out["note"] = "Not enough complete periods for a trend (need at least 2)."
        return out
    changes = [c for c in (_pct(vals[i], vals[i - 1]) for i in range(1, len(vals))) if c is not None]
    if changes:
        out["avg_period_change_pct"] = round(sum(changes) / len(changes), 2)
    out["latest_complete"] = {"label": done[-1]["label"], "value": round(vals[-1], 2),
                              "change_pct_vs_previous": _pct(vals[-1], vals[-2])}
    hi = max(range(len(vals)), key=lambda i: vals[i])
    lo = min(range(len(vals)), key=lambda i: vals[i])
    out["best"] = {"label": done[hi]["label"], "value": round(vals[hi], 2)}
    out["worst"] = {"label": done[lo]["label"], "value": round(vals[lo], 2)}
    out["average"] = round(sum(vals) / len(vals), 2)
    if len(vals) >= 6:
        last3, prev3 = sum(vals[-3:]), sum(vals[-6:-3])
        out["momentum"] = {"last_3_total": round(last3, 2), "previous_3_total": round(prev3, 2), "change_pct": _pct(last3, prev3)}
    fit = linear_fit(vals[-24:])
    if fit and len(vals) >= 6:
        if fit.r2 >= 0.3:
            band = 1.28 * fit.se
            n = fit.n
            out["projection"] = {
                "method": f"straight-line trend through the last {n} complete periods; range = +/-1.28 x standard error (about an 80% band if scatter is normal)",
                "r_squared": round(fit.r2, 3),
                "slope_per_period": round(fit.slope, 2),
                "next_periods": [{"ahead": k, "value": round(fit.intercept + fit.slope * (n - 1 + k), 2),
                                  "low": round(fit.intercept + fit.slope * (n - 1 + k) - band, 2),
                                  "high": round(fit.intercept + fit.slope * (n - 1 + k) + band, 2)} for k in range(1, horizon + 1)],
                "caveat": "A projection, not data: it ignores seasonality, pricing, pipeline and one-off events. Present it as an estimate.",
            }
        else:
            out["projection"] = None
            out["projection_note"] = f"Too irregular for a straight-line projection (R2 {fit.r2:.2f}); do not forecast."
    elif len(vals) < 6:
        out["projection"] = None
        out["projection_note"] = "At least 6 complete periods are needed before a projection is meaningful."
    return out
