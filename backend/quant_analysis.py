from __future__ import annotations

import math
from typing import Any

import numpy as np


# ============================================================
# QUANTITATIVE ANALYSIS
# ============================================================
#
# This module adds statistical and quantitative diagnostics to
# the deterministic strategy backtest.
#
# Important:
# - These are descriptive / simulation-based calculations.
# - They do not predict the next trade.
# - Monte Carlo resamples observed trade outcomes and therefore
#   inherits the assumptions and limitations of the sample.
# - Kelly values are mathematical outputs, not risk advice.
# ============================================================


WILSON_Z_95 = 1.959963984540054
DEFAULT_BOOTSTRAP_SAMPLES = 5000
DEFAULT_MONTE_CARLO_PATHS = 10_000
DEFAULT_MONTE_CARLO_HORIZON = 100
DEFAULT_MONTE_CARLO_SEED = 42
DEFAULT_RUIN_THRESHOLD_PCT = 50.0


def _round_or_none(value: float | None, decimals: int = 4) -> float | None:
    if value is None or not math.isfinite(float(value)):
        return None
    return round(float(value), decimals)


def wilson_interval_pct(
    wins: int,
    total: int,
    confidence_z: float = WILSON_Z_95,
) -> tuple[float | None, float | None]:
    """
    Wilson score interval for a binomial proportion.

    Returned values are percentages.
    """
    if total <= 0:
        return None, None

    p = wins / total
    z = confidence_z
    denominator = 1.0 + (z * z / total)

    center = (
        p
        + (z * z / (2.0 * total))
    ) / denominator

    margin = (
        z
        * math.sqrt(
            (
                p * (1.0 - p)
                + (z * z / (4.0 * total))
            )
            / total
        )
        / denominator
    )

    return (
        round(max(0.0, center - margin) * 100.0, 2),
        round(min(1.0, center + margin) * 100.0, 2),
    )


def _bootstrap_mean_ci(
    values: np.ndarray,
    samples: int,
    seed: int,
) -> tuple[float | None, float | None]:
    if len(values) < 2:
        return None, None

    rng = np.random.default_rng(seed)

    # Keep the bootstrap matrix modest even when the engine is
    # eventually used with a very large trade history.
    sample_count = max(100, int(samples))
    bootstrap_indices = rng.integers(
        0,
        len(values),
        size=(sample_count, len(values)),
    )

    bootstrap_means = values[bootstrap_indices].mean(axis=1)

    lower = float(np.percentile(bootstrap_means, 2.5))
    upper = float(np.percentile(bootstrap_means, 97.5))

    return (
        round(lower, 4),
        round(upper, 4),
    )


def _skewness(values: np.ndarray) -> float | None:
    if len(values) < 3:
        return None

    mean = float(values.mean())
    centered = values - mean
    variance = float(np.mean(centered ** 2))

    if variance <= 0:
        return 0.0

    std = math.sqrt(variance)

    return float(
        np.mean(centered ** 3) / (std ** 3)
    )


def _sharpe_per_trade(values: np.ndarray) -> float | None:
    if len(values) < 2:
        return None

    std = float(np.std(values, ddof=1))

    if std <= 0:
        return None

    # Deliberately NOT annualized.
    return float(values.mean() / std)


def _sortino_per_trade(values: np.ndarray) -> float | None:
    if len(values) < 2:
        return None

    downside = np.minimum(values, 0.0)
    downside_deviation = math.sqrt(
        float(np.mean(downside ** 2))
    )

    if downside_deviation <= 0:
        return None

    # Deliberately NOT annualized.
    return float(values.mean() / downside_deviation)


def _kelly_fraction(
    win_probability: float,
    average_win: float | None,
    average_loss_abs: float | None,
) -> float | None:
    """
    Classical Kelly fraction for a binary win/loss model.

    b = average win / average loss magnitude
    f* = p - q / b

    This is an educational mathematical output.
    It is not a recommended position size.
    """
    if (
        average_win is None
        or average_loss_abs is None
        or average_win <= 0
        or average_loss_abs <= 0
    ):
        return None

    b = average_win / average_loss_abs

    if b <= 0:
        return None

    q = 1.0 - win_probability
    return float(
        win_probability
        - (q / b)
    )


def _max_losing_streak_from_values(
    values: np.ndarray,
) -> int:
    current = 0
    maximum = 0

    for value in values:
        if value <= 0:
            current += 1
            maximum = max(maximum, current)
        else:
            current = 0

    return maximum


def _monte_carlo(
    net_r_values: np.ndarray,
    configured_risk_pct: float,
    paths: int = DEFAULT_MONTE_CARLO_PATHS,
    horizon_trades: int = DEFAULT_MONTE_CARLO_HORIZON,
    seed: int = DEFAULT_MONTE_CARLO_SEED,
    ruin_threshold_pct: float = DEFAULT_RUIN_THRESHOLD_PCT,
) -> dict[str, Any]:
    """
    Resample historical net-R outcomes with replacement.

    Equity starts at 1.0. Each trade changes equity by:

        equity *= 1 + risk_per_trade * sampled_R

    The horizon defaults to 100 trades.

    "Ruin" is deliberately defined as a 50% drawdown proxy rather
    than literal insolvency, because the latter depends on account
    rules, leverage, margin and other factors outside this engine.
    """
    if len(net_r_values) < 2:
        return {
            "enabled": False,
            "reason": "At least 2 historical trades are required.",
        }

    path_count = max(100, int(paths))
    horizon = max(1, int(horizon_trades))
    risk_fraction = max(
        0.0,
        float(configured_risk_pct) / 100.0,
    )
    threshold = abs(float(ruin_threshold_pct))

    rng = np.random.default_rng(seed)

    sampled = rng.choice(
        net_r_values,
        size=(path_count, horizon),
        replace=True,
    )

    growth = 1.0 + (
        sampled
        * risk_fraction
    )

    # A pathological sampled outcome should not create a
    # mathematically negative account balance.
    growth = np.maximum(
        growth,
        0.0,
    )

    equity_paths = np.ones(
        (path_count, horizon + 1),
        dtype=float,
    )

    equity_paths[:, 1:] = np.cumprod(
        growth,
        axis=1,
    )

    running_peak = np.maximum.accumulate(
        equity_paths,
        axis=1,
    )

    drawdowns = (
        equity_paths
        / np.maximum(
            running_peak,
            1e-12,
        )
    ) - 1.0

    max_drawdown_pct = (
        np.min(
            drawdowns,
            axis=1,
        )
        * 100.0
    )

    sampled_loss = (
        sampled <= 0
    ).astype(np.int8)

    current_streak = np.zeros(
        path_count,
        dtype=np.int16,
    )
    max_streak = np.zeros(
        path_count,
        dtype=np.int16,
    )

    for column in range(horizon):
        losing = sampled_loss[:, column] == 1

        current_streak[losing] += 1
        current_streak[~losing] = 0

        max_streak = np.maximum(
            max_streak,
            current_streak,
        )

    final_equity = equity_paths[:, -1]

    return {
        "enabled": True,
        "paths": path_count,
        "horizon_trades": horizon,
        "seed": seed,
        "risk_per_trade_pct": round(
            float(configured_risk_pct),
            4,
        ),
        "ruin_proxy_threshold_pct": round(
            threshold,
            2,
        ),
        "median_final_equity_pct": round(
            float(np.percentile(final_equity, 50.0) * 100.0),
            2,
        ),
        "p05_final_equity_pct": round(
            float(np.percentile(final_equity, 5.0) * 100.0),
            2,
        ),
        "p01_final_equity_pct": round(
            float(np.percentile(final_equity, 1.0) * 100.0),
            2,
        ),
        "probability_of_loss_pct": round(
            float(
                np.mean(final_equity < 1.0)
                * 100.0
            ),
            2,
        ),
        "probability_drawdown_20pct_pct": round(
            float(
                np.mean(max_drawdown_pct <= -20.0)
                * 100.0
            ),
            2,
        ),
        "probability_drawdown_50pct_pct": round(
            float(
                np.mean(max_drawdown_pct <= -50.0)
                * 100.0
            ),
            2,
        ),
        "probability_of_ruin_proxy_pct": round(
            float(
                np.mean(
                    max_drawdown_pct
                    <= -threshold
                )
                * 100.0
            ),
            2,
        ),
        "median_max_drawdown_pct": round(
            float(
                abs(
                    np.percentile(
                        max_drawdown_pct,
                        50.0,
                    )
                )
            ),
            2,
        ),
        "p95_max_drawdown_pct": round(
            float(
                abs(
                    np.percentile(
                        max_drawdown_pct,
                        5.0,
                    )
                )
            ),
            2,
        ),
        "median_max_losing_streak": int(
            round(
                float(
                    np.percentile(
                        max_streak,
                        50.0,
                    )
                )
            )
        ),
        "p95_max_losing_streak": int(
            round(
                float(
                    np.percentile(
                        max_streak,
                        95.0,
                    )
                )
            )
        ),
        "assumptions": (
            "Historical net-R outcomes are resampled with replacement. "
            "This does not model serial dependence, regime changes, "
            "future strategy degradation or market impact beyond the "
            "cost assumptions already present in the trade results."
        ),
    }


def analyze_trade_quant_metrics(
    trades: list[dict[str, Any]],
    strategy: dict[str, Any],
) -> dict[str, Any]:
    """
    Produce professional-style statistical diagnostics from the
    already simulated trade outcomes.

    The output intentionally separates:
    - observed statistics,
    - uncertainty estimates,
    - cost sensitivity,
    - Kelly mathematics,
    - Monte Carlo simulation.
    """
    net_values = np.array(
        [
            float(trade["net_r"])
            for trade in trades
            if trade.get("net_r") is not None
        ],
        dtype=float,
    )

    gross_values = np.array(
        [
            float(
                trade.get(
                    "gross_r",
                    trade.get("net_r", 0.0),
                )
            )
            for trade in trades
            if trade.get("net_r") is not None
        ],
        dtype=float,
    )

    pre_cost_values = np.array(
        [
            float(
                trade.get(
                    "gross_r_before_costs",
                    trade.get(
                        "gross_r",
                        trade.get("net_r", 0.0),
                    ),
                )
            )
            for trade in trades
            if trade.get("net_r") is not None
        ],
        dtype=float,
    )

    if len(net_values) == 0:
        return {
            "available": False,
            "reason": "No completed trades are available.",
        }

    wins = net_values[net_values > 0]
    losses = net_values[net_values <= 0]

    win_count = int(len(wins))
    total = int(len(net_values))

    win_probability = (
        win_count / total
    )

    confidence_low, confidence_high = (
        wilson_interval_pct(
            win_count,
            total,
        )
    )

    average_win = (
        float(wins.mean())
        if len(wins)
        else None
    )

    average_loss = (
        float(losses.mean())
        if len(losses)
        else None
    )

    average_loss_abs = (
        abs(average_loss)
        if average_loss is not None
        else None
    )

    payoff_ratio = (
        average_win / average_loss_abs
        if (
            average_win is not None
            and average_loss_abs
            and average_loss_abs > 0
        )
        else None
    )

    kelly = _kelly_fraction(
        win_probability,
        average_win,
        average_loss_abs,
    )

    configured_risk_pct = float(
        strategy.get(
            "risk",
            {},
        ).get(
            "configured_risk_pct",
            1.0,
        )
    )

    bootstrap_low, bootstrap_high = (
        _bootstrap_mean_ci(
            net_values,
            DEFAULT_BOOTSTRAP_SAMPLES,
            DEFAULT_MONTE_CARLO_SEED,
        )
    )

    gross_expectancy = float(
        pre_cost_values.mean()
    )

    after_slippage_expectancy = float(
        gross_values.mean()
    )

    net_expectancy = float(
        net_values.mean()
    )

    slippage_drag = (
        pre_cost_values
        - gross_values
    )

    fee_drag = (
        gross_values
        - net_values
    )

    mc = _monte_carlo(
        net_values,
        configured_risk_pct,
    )

    return {
        "available": True,

        "sample": {
            "trades": total,
            "wins": win_count,
            "losses": int(len(losses)),
        },

        "statistical_uncertainty": {
            "win_rate_95_ci_low_pct": confidence_low,
            "win_rate_95_ci_high_pct": confidence_high,
            "expectancy_bootstrap_95_ci_low_r": bootstrap_low,
            "expectancy_bootstrap_95_ci_high_r": bootstrap_high,
            "note": (
                "Confidence intervals describe uncertainty in the "
                "estimated historical statistic; they are not "
                "probabilities for the next trade."
            ),
        },

        "trade_distribution": {
            "mean_r": _round_or_none(
                float(net_values.mean())
            ),
            "median_r": _round_or_none(
                float(np.median(net_values))
            ),
            "std_r": _round_or_none(
                float(np.std(net_values, ddof=1))
                if len(net_values) > 1
                else None
            ),
            "p05_r": _round_or_none(
                float(np.percentile(net_values, 5.0))
            ),
            "p25_r": _round_or_none(
                float(np.percentile(net_values, 25.0))
            ),
            "p75_r": _round_or_none(
                float(np.percentile(net_values, 75.0))
            ),
            "p95_r": _round_or_none(
                float(np.percentile(net_values, 95.0))
            ),
            "average_win_r": _round_or_none(
                average_win
            ),
            "average_loss_r": _round_or_none(
                average_loss
            ),
            "payoff_ratio": _round_or_none(
                payoff_ratio,
                3,
            ),
            "skewness": _round_or_none(
                _skewness(net_values),
                3,
            ),
        },

        "risk_adjusted": {
            "sharpe_per_trade": _round_or_none(
                _sharpe_per_trade(net_values),
                3,
            ),
            "sortino_per_trade": _round_or_none(
                _sortino_per_trade(net_values),
                3,
            ),
            "note": (
                "These Sharpe and Sortino values are per-trade "
                "statistics and are intentionally not annualized."
            ),
        },

        "expectancy_and_costs": {
            "gross_expectancy_before_costs_r": _round_or_none(
                gross_expectancy
            ),
            "after_slippage_expectancy_r": _round_or_none(
                after_slippage_expectancy
            ),
            "net_expectancy_after_fees_r": _round_or_none(
                net_expectancy
            ),
            "average_slippage_drag_r": _round_or_none(
                float(slippage_drag.mean())
            ),
            "average_fee_drag_r": _round_or_none(
                float(fee_drag.mean())
            ),
            "average_total_cost_drag_r": _round_or_none(
                float(
                    (
                        pre_cost_values
                        - net_values
                    ).mean()
                )
            ),
        },

        "kelly": {
            "win_probability_used_pct": round(
                win_probability * 100.0,
                2,
            ),
            "full_kelly_pct": _round_or_none(
                kelly * 100.0
                if kelly is not None
                else None,
                2,
            ),
            "half_kelly_pct": _round_or_none(
                kelly * 50.0
                if kelly is not None
                else None,
                2,
            ),
            "quarter_kelly_pct": _round_or_none(
                kelly * 25.0
                if kelly is not None
                else None,
                2,
            ),
            "note": (
                "Kelly is a mathematical sizing formula based on "
                "estimated win probability and payoff. These values "
                "are educational calculations, not position-size "
                "recommendations."
            ),
        },

        "observed_streaks": {
            "historical_max_losing_streak": int(
                _max_losing_streak_from_values(
                    net_values
                )
            ),
        },

        "monte_carlo": mc,
    }
