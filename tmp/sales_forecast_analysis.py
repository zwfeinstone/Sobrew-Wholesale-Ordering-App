from __future__ import annotations

import calendar
import json
import math
from dataclasses import dataclass
from datetime import date, timedelta
from pathlib import Path

import numpy as np


WEEKLY_DATES = [
    "2026-03-02", "2026-03-09", "2026-03-16", "2026-03-23",
    "2026-03-30", "2026-04-06", "2026-04-13", "2026-04-20",
    "2026-04-27", "2026-05-04", "2026-05-11", "2026-05-18",
    "2026-05-25", "2026-06-01", "2026-06-08", "2026-06-15",
    "2026-06-22", "2026-06-29", "2026-07-06", "2026-07-13",
    "2026-07-20", "2026-07-27", "2026-08-03", "2026-08-10",
    "2026-08-17",
]

# Standard shipped wholesale revenue, recognized at shipped_at with created_at fallback.
# The 2026-08-17 week is through Friday 2026-08-21 and is treated as effectively
# complete because recent shipments are overwhelmingly Monday-Friday.
WEEKLY_REVENUE = np.array([
    20.00, 450.00, 60.00, 525.00, 1655.18, 861.00, 1210.33,
    1732.00, 2311.34, 2913.05, 1140.00, 1851.50, 4767.70,
    2433.90, 1243.19, 4210.50, 2651.20, 2048.20, 2101.05,
    4580.44, 4178.60, 3373.30, 4236.50, 3743.80, 3575.10,
], dtype=float)

CASH_MONTHLY_DATES = [
    "2026-01-01", "2026-02-01", "2026-03-01", "2026-04-01",
    "2026-05-01", "2026-06-01", "2026-07-01",
]
CASH_MONTHLY = np.array([
    4898.48, 4632.68, 3853.03, 6656.15, 8319.26, 11722.24, 15484.04
], dtype=float)

FORECAST_MONTHS = []
cursor = date(2026, 9, 1)
for _ in range(16):
    FORECAST_MONTHS.append(cursor)
    cursor = date(cursor.year + (cursor.month == 12), 1 if cursor.month == 12 else cursor.month + 1, 1)


@dataclass
class HoltFit:
    alpha: float
    beta: float
    phi: float
    level: float
    trend: float
    sse: float


def holt_fit(values: np.ndarray) -> HoltFit:
    y = np.log1p(np.asarray(values, dtype=float))
    best: HoltFit | None = None
    alphas = np.arange(0.10, 1.00, 0.10)
    betas = np.arange(0.05, 0.55, 0.05)
    phis = np.arange(0.75, 0.951, 0.025)
    for alpha in alphas:
        for beta in betas:
            for phi in phis:
                level = y[0]
                trend = y[1] - y[0] if len(y) > 1 else 0.0
                sse = 0.0
                for obs in y[1:]:
                    pred = level + phi * trend
                    err = obs - pred
                    sse += float(err * err)
                    new_level = alpha * obs + (1.0 - alpha) * pred
                    new_trend = beta * (new_level - level) + (1.0 - beta) * phi * trend
                    level, trend = new_level, new_trend
                candidate = HoltFit(float(alpha), float(beta), float(phi), float(level), float(trend), sse)
                if best is None or candidate.sse < best.sse:
                    best = candidate
    assert best is not None
    return best


def holt_forecast(values: np.ndarray, horizon: int) -> tuple[np.ndarray, HoltFit]:
    fit = holt_fit(values)
    forecasts = []
    damp_sum = 0.0
    for h in range(1, horizon + 1):
        damp_sum += fit.phi ** h
        log_value = fit.level + damp_sum * fit.trend
        forecasts.append(max(0.0, math.expm1(log_value)))
    return np.array(forecasts), fit


def ma_forecast(values: np.ndarray, horizon: int, window: int = 4) -> np.ndarray:
    base = float(np.mean(values[-min(window, len(values)):]))
    return np.full(horizon, base, dtype=float)


def metrics(actual: list[float], predicted: list[float]) -> dict[str, float]:
    a = np.asarray(actual, dtype=float)
    p = np.asarray(predicted, dtype=float)
    err = p - a
    mae = float(np.mean(np.abs(err)))
    smape = float(np.mean(2.0 * np.abs(err) / np.maximum(np.abs(a) + np.abs(p), 1e-9)))
    bias = float(np.mean(err))
    return {"mae": mae, "smape": smape, "bias": bias}


def rolling_backtest(values: np.ndarray, min_train: int = 8, horizon: int = 4) -> dict:
    records = {"ma4": {1: [[], []], 4: [[], []]}, "holt_log_damped": {1: [[], []], 4: [[], []]}}
    one_step_detail = []
    for cutoff in range(min_train, len(values)):
        max_h = min(horizon, len(values) - cutoff)
        if max_h <= 0:
            continue
        train = values[:cutoff]
        forecasts = {
            "ma4": ma_forecast(train, max_h),
            "holt_log_damped": holt_forecast(train, max_h)[0],
        }
        for name, fc in forecasts.items():
            records[name][1][0].append(float(values[cutoff]))
            records[name][1][1].append(float(fc[0]))
            if max_h >= 4:
                records[name][4][0].append(float(values[cutoff + 3]))
                records[name][4][1].append(float(fc[3]))
        one_step_detail.append({
            "actual": float(values[cutoff]),
            "ma4": float(forecasts["ma4"][0]),
            "holt_log_damped": float(forecasts["holt_log_damped"][0]),
        })

    result = {}
    for name in records:
        m1 = metrics(*records[name][1])
        m4 = metrics(*records[name][4])
        score = 0.6 * m1["smape"] + 0.4 * m4["smape"]
        result[name] = {"h1": m1, "h4": m4, "weighted_smape": score}
    inverse = {name: 1.0 / max(vals["weighted_smape"], 1e-6) for name, vals in result.items()}
    denom = sum(inverse.values())
    weights = {name: value / denom for name, value in inverse.items()}
    for row in one_step_detail:
        row["ensemble"] = sum(row[name] * weights[name] for name in weights)
        row["log_residual"] = math.log(max(row["actual"], 1.0) / max(row["ensemble"], 1.0))
    return {"metrics": result, "weights": weights, "one_step": one_step_detail}


def business_days_in_month(month: date) -> list[date]:
    days = calendar.monthrange(month.year, month.month)[1]
    return [date(month.year, month.month, d) for d in range(1, days + 1) if date(month.year, month.month, d).weekday() < 5]


def weekly_to_monthly(weekly: np.ndarray, start_week: date = date(2026, 8, 24)) -> np.ndarray:
    out = []
    for month in FORECAST_MONTHS:
        total = 0.0
        for day in business_days_in_month(month):
            monday = day - timedelta(days=day.weekday())
            idx = (monday - start_week).days // 7
            if idx < 0:
                idx = 0
            if idx >= len(weekly):
                idx = len(weekly) - 1
            total += float(weekly[idx]) / 5.0
        out.append(total)
    return np.array(out)


def driver_path(params: dict[str, float]) -> tuple[np.ndarray, np.ndarray]:
    active = float(params["starting_active_customers"])
    aov = float(params["starting_aov"])
    actives = []
    revenue = []
    for _ in FORECAST_MONTHS:
        active = active * params["retention"] + params["new_customers"] + params["reactivated_customers"]
        aov *= 1.0 + params["monthly_aov_growth"]
        monthly = active * params["orders_per_active_customer"] * aov
        monthly = max(monthly, params["recurring_floor"])
        actives.append(active)
        revenue.append(monthly)
    return np.array(actives), np.array(revenue)


def percentile_path(simulations: np.ndarray, percentile: float, horizon: int = 12) -> np.ndarray:
    totals = simulations[:, :horizon].sum(axis=1)
    target = float(np.percentile(totals, percentile))
    idx = int(np.argmin(np.abs(totals - target)))
    return simulations[idx]


def main() -> None:
    rng = np.random.default_rng(20260821)
    backtest = rolling_backtest(WEEKLY_REVENUE)
    horizon_weeks = 72
    ma_weekly = ma_forecast(WEEKLY_REVENUE, horizon_weeks)
    holt_weekly, weekly_holt_fit = holt_forecast(WEEKLY_REVENUE, horizon_weeks)
    weights = backtest["weights"]
    ensemble_weekly = weights["ma4"] * ma_weekly + weights["holt_log_damped"] * holt_weekly
    ensemble_monthly = weekly_to_monthly(ensemble_weekly)

    residuals = np.array([row["log_residual"] for row in backtest["one_step"]], dtype=float)
    residuals -= residuals.mean()
    ts_sims = []
    for _ in range(6000):
        # Two-week blocks retain some run/lumpiness in weekly wholesale orders.
        sampled = []
        while len(sampled) < horizon_weeks:
            start = int(rng.integers(0, max(1, len(residuals) - 1)))
            sampled.extend(residuals[start:start + 2].tolist())
        shock = np.array(sampled[:horizon_weeks])
        # A persistent model-level shock captures the risk that the young business
        # settles at a structurally different run rate than the short history implies.
        structural_shock = float(rng.normal(0.0, 0.14))
        # Center log shocks so the simulation median remains close to the point forecast.
        weekly_draw = ensemble_weekly * np.exp(shock + structural_shock)
        ts_sims.append(weekly_to_monthly(weekly_draw))
    ts_sims = np.array(ts_sims)
    # Month-wise quantiles keep the three scenario paths ordered in every period.
    ts_p20 = np.percentile(ts_sims, 20, axis=0)
    ts_p50 = np.percentile(ts_sims, 50, axis=0)
    ts_p80 = np.percentile(ts_sims, 80, axis=0)

    recurring_floor = 918.50 * 26.0 / 12.0 + 142.00 * (52.0 / 3.0) / 12.0 + 2559.00 * 13.0 / 12.0
    assumptions = {
        "conservative": {
            "starting_active_customers": 42.0,
            "retention": 0.74,
            "new_customers": 7.0,
            "reactivated_customers": 1.0,
            "orders_per_active_customer": 1.55,
            "starting_aov": 214.0,
            "monthly_aov_growth": 0.000,
            "recurring_floor": recurring_floor,
        },
        "normal": {
            "starting_active_customers": 42.0,
            "retention": 0.78,
            "new_customers": 9.0,
            "reactivated_customers": 1.5,
            "orders_per_active_customer": 1.65,
            "starting_aov": 223.0,
            "monthly_aov_growth": 0.002,
            "recurring_floor": recurring_floor,
        },
        "aggressive": {
            "starting_active_customers": 42.0,
            "retention": 0.84,
            "new_customers": 12.0,
            "reactivated_customers": 2.0,
            "orders_per_active_customer": 1.72,
            "starting_aov": 232.0,
            "monthly_aov_growth": 0.004,
            "recurring_floor": recurring_floor,
        },
    }
    driver = {}
    for scenario, params in assumptions.items():
        active, revenue = driver_path(params)
        driver[scenario] = {"active_customers": active, "revenue": revenue}

    blend_weight_ts = 0.55
    blend_weight_driver = 1.0 - blend_weight_ts
    final = {
        "conservative": blend_weight_ts * ts_p20 + blend_weight_driver * driver["conservative"]["revenue"],
        "normal": blend_weight_ts * ts_p50 + blend_weight_driver * driver["normal"]["revenue"],
        "aggressive": blend_weight_ts * ts_p80 + blend_weight_driver * driver["aggressive"]["revenue"],
    }

    # Full ensemble simulations for total uncertainty intervals.
    combined_sims = []
    for i in range(len(ts_sims)):
        random_params = {
            "starting_active_customers": float(rng.triangular(38.0, 42.0, 48.0)),
            "retention": float(rng.triangular(0.65, 0.78, 0.88)),
            "new_customers": float(rng.triangular(4.0, 9.0, 15.0)),
            "reactivated_customers": float(rng.triangular(0.0, 1.5, 3.0)),
            "orders_per_active_customer": float(rng.triangular(1.40, 1.65, 1.85)),
            "starting_aov": float(rng.triangular(195.0, 223.0, 245.0)),
            "monthly_aov_growth": float(rng.triangular(-0.005, 0.002, 0.008)),
            "recurring_floor": recurring_floor,
        }
        _, driver_draw = driver_path(random_params)
        combined_sims.append(blend_weight_ts * ts_sims[i] + blend_weight_driver * driver_draw)
    combined_sims = np.array(combined_sims)
    next12_totals = combined_sims[:, :12].sum(axis=1)

    cash_fc, cash_fit = holt_forecast(CASH_MONTHLY, 16)

    # Company-wide current-year bridge: QuickBooks YTD through Aug 5 plus portal
    # shipments Aug 6-21. This is an estimated current actual, not an audited close.
    qb_ytd_aug5 = 64673.49
    portal_aug6_21 = 8936.40
    current_company_ytd_est = qb_ytd_aug5 + portal_aug6_21
    # Six remaining business days in August at scenario-specific weekly/daily run rates.
    aug_remaining = {
        "conservative": float(ts_p20[0] / len(business_days_in_month(date(2026, 9, 1))) * 6.0),
        "normal": float(ts_p50[0] / len(business_days_in_month(date(2026, 9, 1))) * 6.0),
        "aggressive": float(ts_p80[0] / len(business_days_in_month(date(2026, 9, 1))) * 6.0),
    }

    summaries = {}
    for scenario, path in final.items():
        next12 = float(path[:12].sum())
        cy2027 = float(path[4:16].sum())
        cy2026 = float(current_company_ytd_est + aug_remaining[scenario] + path[:4].sum())
        summaries[scenario] = {
            "next_12_months": next12,
            "cy2026": cy2026,
            "cy2027": cy2027,
            "cy2027_growth": cy2027 / cy2026 - 1.0,
            "aug_remaining": aug_remaining[scenario],
        }

    result = {
        "as_of_date": "2026-08-21",
        "forecast_months": [d.isoformat() for d in FORECAST_MONTHS],
        "weekly": {
            "dates": WEEKLY_DATES,
            "revenue": WEEKLY_REVENUE.tolist(),
            "ma4_forecast": ma_weekly.tolist(),
            "holt_forecast": holt_weekly.tolist(),
            "ensemble_forecast": ensemble_weekly.tolist(),
            "holt_fit": weekly_holt_fit.__dict__,
            "backtest": backtest,
        },
        "time_series_monthly": {
            "p20": ts_p20.tolist(),
            "p50": ts_p50.tolist(),
            "p80": ts_p80.tolist(),
            "point": ensemble_monthly.tolist(),
        },
        "cash_receipts": {
            "dates": CASH_MONTHLY_DATES,
            "actual": CASH_MONTHLY.tolist(),
            "holt_forecast": cash_fc.tolist(),
            "holt_fit": cash_fit.__dict__,
        },
        "assumptions": assumptions,
        "driver": {
            scenario: {
                "active_customers": values["active_customers"].tolist(),
                "revenue": values["revenue"].tolist(),
            }
            for scenario, values in driver.items()
        },
        "blend_weights": {"time_series": blend_weight_ts, "driver": blend_weight_driver},
        "final": {scenario: path.tolist() for scenario, path in final.items()},
        "uncertainty": {
            "next12_p2_5": float(np.percentile(next12_totals, 2.5)),
            "next12_p10": float(np.percentile(next12_totals, 10)),
            "next12_p20": float(np.percentile(next12_totals, 20)),
            "next12_p50": float(np.percentile(next12_totals, 50)),
            "next12_p80": float(np.percentile(next12_totals, 80)),
            "next12_p90": float(np.percentile(next12_totals, 90)),
            "next12_p97_5": float(np.percentile(next12_totals, 97.5)),
            "monthly_p10": np.percentile(combined_sims, 10, axis=0).tolist(),
            "monthly_p90": np.percentile(combined_sims, 90, axis=0).tolist(),
        },
        "company_bridge": {
            "quickbooks_ytd_through_2026_08_05": qb_ytd_aug5,
            "portal_shipments_2026_08_06_through_2026_08_21": portal_aug6_21,
            "estimated_company_ytd_through_2026_08_21": current_company_ytd_est,
        },
        "summary": summaries,
    }

    output = Path("tmp/sales_forecast_results.json")
    output.parent.mkdir(parents=True, exist_ok=True)
    output.write_text(json.dumps(result, indent=2), encoding="utf-8")
    print(json.dumps({
        "weights": result["weekly"]["backtest"]["weights"],
        "backtest": result["weekly"]["backtest"]["metrics"],
        "holt_fit": result["weekly"]["holt_fit"],
        "cash_holt_fit": result["cash_receipts"]["holt_fit"],
        "cash_next12": sum(result["cash_receipts"]["holt_forecast"][:12]),
        "summary": result["summary"],
        "uncertainty": result["uncertainty"],
        "first_months": {
            key: [round(x, 2) for x in value[:4]] for key, value in result["final"].items()
        },
    }, indent=2))


if __name__ == "__main__":
    main()
