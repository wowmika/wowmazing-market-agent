from __future__ import annotations

import math
from typing import Any

import numpy as np
import pandas as pd

try:
    from .quant_analysis import (
        analyze_trade_quant_metrics,
    )
except ImportError:
    from quant_analysis import (
        analyze_trade_quant_metrics,
    )


# ============================================================
# DEFAULT STRATEGY
# ============================================================
#
# This is our first example strategy.
#
# It is deliberately explicit and measurable.
#
# LONG:
#   Price > VWAP
#   Price > EMA20
#   EMA20 > EMA50
#   RSI within configured range
#   Volume ratio above configured threshold
#
# EXIT:
#   ATR-based stop
#   R-multiple target
#   Maximum holding period
#
# Important:
# Historical win rate is NOT treated as the probability
# of the next trade winning.
# ============================================================

DEFAULT_STRATEGY: dict[str, Any] = {
    "name": "Momentum-15 v1",
    "direction": "LONG",

    "entry": {
        "price_above_vwap": True,
        "price_above_ema20": True,
        "ema20_above_ema50": True,
        "rsi_min": 52.0,
        "rsi_max": 68.0,
        "volume_ratio_min": 1.50,
    },

    "exit": {
        "stop_atr": 1.50,
        "target_r": 2.00,
        "max_hold_bars": 20,
    },

    "costs": {
        # 0.03% per side.
        "fee_pct": 0.03,

        # 0.02% price slippage.
        "slippage_pct": 0.02,
    },

    # This is user-configured risk.
    # The engine does not recommend this value.
    "risk": {
        "configured_risk_pct": 1.00,
    },
}


# ============================================================
# DATA PREPARATION
# ============================================================

def prepare_ohlcv(
    data: pd.DataFrame,
) -> pd.DataFrame:
    """
    Validate and standardize OHLCV input.
    """

    required = [
        "Open",
        "High",
        "Low",
        "Close",
        "Volume",
    ]

    missing = [
        column
        for column in required
        if column not in data.columns
    ]

    if missing:
        raise ValueError(
            "Missing required columns: "
            + ", ".join(missing)
        )

    frame = data[
        required
    ].copy()

    for column in required:
        frame[column] = pd.to_numeric(
            frame[column],
            errors="coerce",
        )

    frame.dropna(
        subset=[
            "Open",
            "High",
            "Low",
            "Close",
        ],
        inplace=True,
    )

    frame["Volume"] = (
        frame["Volume"]
        .fillna(0)
    )

    frame = frame[
        ~frame.index.duplicated(
            keep="last"
        )
    ]

    frame.sort_index(
        inplace=True
    )

    if len(frame) < 100:
        raise ValueError(
            "At least 100 candles are required."
        )

    return frame


# ============================================================
# INDICATORS
# ============================================================

def ema(
    series: pd.Series,
    period: int,
) -> pd.Series:

    return series.ewm(
        span=period,
        adjust=False,
    ).mean()


def rsi(
    close: pd.Series,
    period: int = 14,
) -> pd.Series:

    delta = close.diff()

    gain = delta.clip(
        lower=0
    )

    loss = -delta.clip(
        upper=0
    )

    avg_gain = gain.ewm(
        alpha=1 / period,
        adjust=False,
        min_periods=period,
    ).mean()

    avg_loss = loss.ewm(
        alpha=1 / period,
        adjust=False,
        min_periods=period,
    ).mean()

    rs = (
        avg_gain
        / avg_loss.replace(
            0,
            np.nan,
        )
    )

    result = (
        100
        - (
            100
            / (1 + rs)
        )
    )

    return result.fillna(50)


def atr(
    data: pd.DataFrame,
    period: int = 14,
) -> pd.Series:

    previous_close = (
        data["Close"].shift(1)
    )

    true_range = pd.concat(
        [
            data["High"]
            - data["Low"],

            (
                data["High"]
                - previous_close
            ).abs(),

            (
                data["Low"]
                - previous_close
            ).abs(),
        ],
        axis=1,
    ).max(
        axis=1
    )

    return (
        true_range
        .rolling(period)
        .mean()
    )


def add_indicators(
    data: pd.DataFrame,
) -> pd.DataFrame:
    """
    Calculate all indicators required by the first
    strategy engine.
    """

    frame = data.copy()

    frame["EMA20"] = ema(
        frame["Close"],
        20,
    )

    frame["EMA50"] = ema(
        frame["Close"],
        50,
    )

    frame["EMA200"] = ema(
        frame["Close"],
        200,
    )

    frame["RSI"] = rsi(
        frame["Close"]
    )

    frame["ATR"] = atr(
        frame
    )

    typical_price = (
        frame["High"]
        + frame["Low"]
        + frame["Close"]
    ) / 3

    if isinstance(
        frame.index,
        pd.DatetimeIndex,
    ):

        if frame.index.tz is not None:

            local_index = (
                frame.index
                .tz_convert(
                    "Asia/Kolkata"
                )
            )

        else:

            local_index = (
                frame.index
                .tz_localize(
                    "Asia/Kolkata"
                )
            )

        dates = (
            local_index
            .normalize()
        )

        cumulative_pv = (
            typical_price
            * frame["Volume"]
        ).groupby(
            dates
        ).cumsum()

        cumulative_volume = (
            frame["Volume"]
            .groupby(
                dates
            )
            .cumsum()
        )

        frame["VWAP"] = (
            cumulative_pv
            / cumulative_volume.replace(
                0,
                np.nan,
            )
        )

    else:

        frame["VWAP"] = (
            typical_price
            * frame["Volume"]
        ).rolling(
            20
        ).sum() / (
            frame["Volume"]
            .rolling(20)
            .sum()
            .replace(
                0,
                np.nan,
            )
        )

    frame["VOLUME_AVG20"] = (
        frame["Volume"]
        .rolling(20)
        .mean()
    )

    frame["VOLUME_RATIO"] = (
        frame["Volume"]
        / frame["VOLUME_AVG20"].replace(
            0,
            np.nan,
        )
    )

    return frame


# ============================================================
# ENTRY CONDITION
# ============================================================

def evaluate_entry_conditions(
    row: pd.Series,
    strategy: dict[str, Any],
) -> tuple[bool, list[dict[str, Any]]]:
    """
    Evaluate every configured entry condition.

    Returns:
        all_conditions_passed
        condition_details
    """

    config = strategy[
        "entry"
    ]

    details: list[
        dict[str, Any]
    ] = []

    # --------------------------------------------------------
    # Price > VWAP
    # --------------------------------------------------------

    if config.get(
        "price_above_vwap",
        False,
    ):

        passed = (
            float(row["Close"])
            > float(row["VWAP"])
        )

        details.append(
            {
                "name": "Price above VWAP",
                "passed": passed,
                "actual": float(
                    row["Close"]
                ),
                "reference": float(
                    row["VWAP"]
                ),
            }
        )

        if not passed:
            return False, details

    # --------------------------------------------------------
    # Price > EMA20
    # --------------------------------------------------------

    if config.get(
        "price_above_ema20",
        False,
    ):

        passed = (
            float(row["Close"])
            > float(row["EMA20"])
        )

        details.append(
            {
                "name": "Price above EMA20",
                "passed": passed,
                "actual": float(
                    row["Close"]
                ),
                "reference": float(
                    row["EMA20"]
                ),
            }
        )

        if not passed:
            return False, details

    # --------------------------------------------------------
    # EMA20 > EMA50
    # --------------------------------------------------------

    if config.get(
        "ema20_above_ema50",
        False,
    ):

        passed = (
            float(row["EMA20"])
            > float(row["EMA50"])
        )

        details.append(
            {
                "name": "EMA20 above EMA50",
                "passed": passed,
                "actual": float(
                    row["EMA20"]
                ),
                "reference": float(
                    row["EMA50"]
                ),
            }
        )

        if not passed:
            return False, details

    # --------------------------------------------------------
    # RSI range
    # --------------------------------------------------------

    rsi_value = float(
        row["RSI"]
    )

    rsi_min = float(
        config.get(
            "rsi_min",
            0,
        )
    )

    rsi_max = float(
        config.get(
            "rsi_max",
            100,
        )
    )

    rsi_passed = (
        rsi_min
        <= rsi_value
        <= rsi_max
    )

    details.append(
        {
            "name": "RSI range",
            "passed": rsi_passed,
            "actual": rsi_value,
            "minimum": rsi_min,
            "maximum": rsi_max,
        }
    )

    if not rsi_passed:
        return False, details

    # --------------------------------------------------------
    # Volume ratio
    # --------------------------------------------------------

    volume_ratio = float(
        row["VOLUME_RATIO"]
    )

    volume_min = float(
        config.get(
            "volume_ratio_min",
            0,
        )
    )

    volume_passed = (
        volume_ratio
        >= volume_min
    )

    details.append(
        {
            "name": "Volume ratio",
            "passed": volume_passed,
            "actual": volume_ratio,
            "minimum": volume_min,
        }
    )

    if not volume_passed:
        return False, details

    return True, details


# ============================================================
# TRADE COSTS
# ============================================================

def apply_entry_slippage(
    price: float,
    direction: str,
    slippage_pct: float,
) -> float:

    slip = (
        slippage_pct
        / 100
    )

    if direction == "LONG":
        return price * (
            1 + slip
        )

    return price * (
        1 - slip
    )


def apply_exit_slippage(
    price: float,
    direction: str,
    slippage_pct: float,
) -> float:

    slip = (
        slippage_pct
        / 100
    )

    if direction == "LONG":
        return price * (
            1 - slip
        )

    return price * (
        1 + slip
    )


# ============================================================
# SINGLE TRADE
# ============================================================

def simulate_trade(
    data: pd.DataFrame,
    signal_index: int,
    strategy: dict[str, Any],
) -> tuple[
    dict[str, Any] | None,
    int,
]:
    """
    Enter at the next candle open after the signal candle.

    Exit priority:
        1. Stop
        2. Target
        3. Maximum holding period

    If both stop and target are touched inside the same
    candle, STOP is assumed first.

    That is deliberately conservative.
    """

    if signal_index + 1 >= len(data):
        return None, signal_index + 1

    row = data.iloc[
        signal_index
    ]

    entry_bar = data.iloc[
        signal_index + 1
    ]

    direction = (
        strategy
        .get(
            "direction",
            "LONG",
        )
        .upper()
    )

    exit_config = strategy[
        "exit"
    ]

    costs = strategy[
        "costs"
    ]

    stop_atr = float(
        exit_config.get(
            "stop_atr",
            1.5,
        )
    )

    target_r = float(
        exit_config.get(
            "target_r",
            2.0,
        )
    )

    max_hold_bars = int(
        exit_config.get(
            "max_hold_bars",
            20,
        )
    )

    fee_pct = float(
        costs.get(
            "fee_pct",
            0.0,
        )
    )

    slippage_pct = float(
        costs.get(
            "slippage_pct",
            0.0,
        )
    )

    atr_value = float(
        row["ATR"]
    )

    if (
        math.isnan(atr_value)
        or atr_value <= 0
    ):
        return None, signal_index + 1

    raw_entry = float(
        entry_bar["Open"]
    )

    entry_price = (
        apply_entry_slippage(
            raw_entry,
            direction,
            slippage_pct,
        )
    )

    stop_distance = (
        atr_value
        * stop_atr
    )

    if (
        math.isnan(stop_distance)
        or stop_distance <= 0
    ):
        return None, signal_index + 1

    if direction == "LONG":

        stop_price = (
            entry_price
            - stop_distance
        )

        target_price = (
            entry_price
            + (
                stop_distance
                * target_r
            )
        )

    else:

        stop_price = (
            entry_price
            + stop_distance
        )

        target_price = (
            entry_price
            - (
                stop_distance
                * target_r
            )
        )

    exit_index = min(
        signal_index
        + 1
        + max_hold_bars
        - 1,

        len(data)
        - 1,
    )

    exit_price = None
    raw_exit_price = None
    exit_reason = None
    actual_exit_index = (
        signal_index + 1
    )

    # --------------------------------------------------------
    # Look forward through holding period
    # --------------------------------------------------------

    for current_index in range(
        signal_index + 1,
        exit_index + 1,
    ):

        candle = data.iloc[
            current_index
        ]

        high = float(
            candle["High"]
        )

        low = float(
            candle["Low"]
        )

        if direction == "LONG":

            stop_hit = (
                low
                <= stop_price
            )

            target_hit = (
                high
                >= target_price
            )

        else:

            stop_hit = (
                high
                >= stop_price
            )

            target_hit = (
                low
                <= target_price
            )

        # Conservative assumption:
        # if both are reached in the same candle,
        # treat STOP as occurring first.

        if stop_hit:

            raw_exit_price = stop_price

            exit_price = (
                apply_exit_slippage(
                    stop_price,
                    direction,
                    slippage_pct,
                )
            )

            exit_reason = "STOP"
            actual_exit_index = (
                current_index
            )
            break

        if target_hit:

            raw_exit_price = target_price

            exit_price = (
                apply_exit_slippage(
                    target_price,
                    direction,
                    slippage_pct,
                )
            )

            exit_reason = "TARGET"
            actual_exit_index = (
                current_index
            )
            break

    # --------------------------------------------------------
    # Time exit
    # --------------------------------------------------------

    if exit_price is None:

        actual_exit_index = exit_index

        close_price = float(
            data.iloc[
                exit_index
            ]["Close"]
        )

        raw_exit_price = close_price

        exit_price = (
            apply_exit_slippage(
                close_price,
                direction,
                slippage_pct,
            )
        )

        exit_reason = "TIME"

    # --------------------------------------------------------
    # Gross R and execution-cost decomposition
    # --------------------------------------------------------

    if raw_exit_price is None:
        raw_exit_price = float(exit_price)

    if direction == "LONG":

        raw_price_change = (
            raw_exit_price
            - raw_entry
        )

        price_change = (
            exit_price
            - entry_price
        )

    else:

        raw_price_change = (
            raw_entry
            - raw_exit_price
        )

        price_change = (
            entry_price
            - exit_price
        )

    gross_r_before_costs = (
        raw_price_change
        / stop_distance
    )

    gross_r = (
        price_change
        / stop_distance
    )

    slippage_drag_r = (
        gross_r_before_costs
        - gross_r
    )

    # --------------------------------------------------------
    # Fees
    # --------------------------------------------------------

    fee_rate = (
        fee_pct
        / 100
    )

    total_fees = (
        entry_price
        * fee_rate
        + exit_price
        * fee_rate
    )

    fee_r = (
        total_fees
        / stop_distance
    )

    net_r = (
        gross_r
        - fee_r
    )

    entry_timestamp = (
        data.index[
            signal_index + 1
        ]
    )

    exit_timestamp = (
        data.index[
            actual_exit_index
        ]
    )

    trade = {
        "direction": direction,
        "signal_time": str(
            data.index[
                signal_index
            ]
        ),
        "entry_time": str(
            entry_timestamp
        ),
        "exit_time": str(
            exit_timestamp
        ),
        "raw_entry_price": round(
            raw_entry,
            4,
        ),
        "entry_price": round(
            entry_price,
            4,
        ),
        "raw_exit_price": round(
            raw_exit_price,
            4,
        ),
        "exit_price": round(
            exit_price,
            4,
        ),
        "stop_price": round(
            stop_price,
            4,
        ),
        "target_price": round(
            target_price,
            4,
        ),
        "stop_distance": round(
            stop_distance,
            4,
        ),
        "gross_r_before_costs": round(
            gross_r_before_costs,
            4,
        ),
        "gross_r": round(
            gross_r,
            4,
        ),
        "slippage_drag_r": round(
            slippage_drag_r,
            4,
        ),
        "fee_r": round(
            fee_r,
            4,
        ),
        "net_r": round(
            net_r,
            4,
        ),
        "outcome": (
            "WIN"
            if net_r > 0
            else "LOSS"
        ),
        "exit_reason": exit_reason,
        "bars_held": (
            actual_exit_index
            - (
                signal_index + 1
            )
            + 1
        ),
    }

    return (
        trade,
        actual_exit_index,
    )


# ============================================================
# BACKTEST SEGMENT
# ============================================================

def run_backtest_segment(
    data: pd.DataFrame,
    strategy: dict[str, Any],
    start_index: int,
    end_index: int,
) -> list[dict[str, Any]]:
    """
    Backtest a single chronological segment.

    Trades cannot cross the segment boundary.

    Internally, the segment is converted to a local dataframe
    so signal/exit indexes remain consistent.
    """

    # --------------------------------------------------------
    # Create an independent segment.
    #
    # This is the important fix:
    # all indexes used inside simulate_trade() are now
    # relative to this segment.
    # --------------------------------------------------------

    segment = data.iloc[
        start_index:end_index
    ].copy()

    if len(segment) < 3:
        return []

    trades: list[
        dict[str, Any]
    ] = []

    i = 0

    last_signal_index = (
        len(segment) - 2
    )

    while i <= last_signal_index:

        row = segment.iloc[i]

        # ----------------------------------------------------
        # Required indicator values
        # ----------------------------------------------------

        required_values = [
            row.get("EMA20"),
            row.get("EMA50"),
            row.get("RSI"),
            row.get("ATR"),
            row.get("VWAP"),
            row.get("VOLUME_RATIO"),
        ]

        if any(
            pd.isna(value)
            for value in required_values
        ):

            i += 1
            continue

        # ----------------------------------------------------
        # Evaluate strategy entry
        # ----------------------------------------------------

        passed, _ = (
            evaluate_entry_conditions(
                row,
                strategy,
            )
        )

        if not passed:

            i += 1
            continue

        # ----------------------------------------------------
        # Simulate trade using the LOCAL segment index
        # ----------------------------------------------------

        trade, exit_index = (
            simulate_trade(
                segment,
                i,
                strategy,
            )
        )

        if trade is None:

            i += 1
            continue

        trades.append(
            trade
        )

        # ----------------------------------------------------
        # Do not allow overlapping trades.
        #
        # exit_index is relative to "segment", so keeping
        # everything local fixes the previous indexing bug.
        # ----------------------------------------------------

        i = exit_index + 1

    return trades

# ============================================================
# METRICS
# ============================================================

def calculate_max_losing_streak(
    trades: list[dict[str, Any]],
) -> int:

    maximum = 0
    current = 0

    for trade in trades:

        if trade["net_r"] <= 0:

            current += 1

            maximum = max(
                maximum,
                current,
            )

        else:

            current = 0

    return maximum


def calculate_max_drawdown_r(
    trades: list[dict[str, Any]],
) -> float:

    if not trades:
        return 0.0

    equity = 0.0
    peak = 0.0
    max_drawdown = 0.0

    for trade in trades:

        equity += float(
            trade["net_r"]
        )

        peak = max(
            peak,
            equity,
        )

        drawdown = (
            equity
            - peak
        )

        max_drawdown = min(
            max_drawdown,
            drawdown,
        )

    return max_drawdown


def calculate_metrics(
    trades: list[dict[str, Any]],
) -> dict[str, Any]:

    if not trades:

        return {
            "trades": 0,
            "wins": 0,
            "losses": 0,
            "win_rate_pct": None,
            "loss_rate_pct": None,
            "average_r": None,
            "expectancy_r": None,
            "profit_factor": None,
            "max_losing_streak": 0,
            "max_drawdown_r": 0.0,
            "total_r": 0.0,
            "average_hold_bars": None,
            "best_trade_r": None,
            "worst_trade_r": None,
        }

    values = np.array(
        [
            float(
                trade["net_r"]
            )
            for trade in trades
        ]
    )

    wins = values[
        values > 0
    ]

    losses = values[
        values <= 0
    ]

    win_count = len(
        wins
    )

    loss_count = len(
        losses
    )

    total_trades = len(
        values
    )

    win_rate = (
        win_count
        / total_trades
        * 100
    )

    loss_rate = (
        loss_count
        / total_trades
        * 100
    )

    gross_profit = (
        wins.sum()
        if len(wins)
        else 0.0
    )

    gross_loss = abs(
        losses.sum()
    )

    if gross_loss > 0:

        profit_factor = (
            gross_profit
            / gross_loss
        )

    else:

        profit_factor = None

    return {
        "trades": total_trades,

        "wins": win_count,

        "losses": loss_count,

        "win_rate_pct": round(
            float(win_rate),
            2,
        ),

        "loss_rate_pct": round(
            float(loss_rate),
            2,
        ),

        "average_r": round(
            float(values.mean()),
            4,
        ),

        "expectancy_r": round(
            float(values.mean()),
            4,
        ),

        "profit_factor": (
            round(
                float(
                    profit_factor
                ),
                3,
            )
            if profit_factor is not None
            else None
        ),

        "max_losing_streak": (
            calculate_max_losing_streak(
                trades
            )
        ),

        "max_drawdown_r": round(
            float(
                calculate_max_drawdown_r(
                    trades
                )
            ),
            4,
        ),

        "total_r": round(
            float(values.sum()),
            4,
        ),

        "average_hold_bars": round(
            float(
                np.mean(
                    [
                        trade[
                            "bars_held"
                        ]
                        for trade in trades
                    ]
                )
            ),
            2,
        ),

        "best_trade_r": round(
            float(values.max()),
            4,
        ),

        "worst_trade_r": round(
            float(values.min()),
            4,
        ),
    }


# ============================================================
# EVIDENCE SUMMARY
# ============================================================

def evidence_summary(
    train_metrics: dict[str, Any],
    test_metrics: dict[str, Any],
) -> dict[str, Any]:

    train_trades = int(
        train_metrics[
            "trades"
        ]
    )

    test_trades = int(
        test_metrics[
            "trades"
        ]
    )

    train_expectancy = (
        train_metrics[
            "expectancy_r"
        ]
    )

    test_expectancy = (
        test_metrics[
            "expectancy_r"
        ]
    )

    train_win = (
        train_metrics[
            "win_rate_pct"
        ]
    )

    test_win = (
        test_metrics[
            "win_rate_pct"
        ]
    )

    if (
        train_win is None
        or test_win is None
    ):

        win_rate_gap = None

    else:

        win_rate_gap = round(
            abs(
                train_win
                - test_win
            ),
            2,
        )

    # --------------------------------------------------------
    # Coverage label
    #
    # This does NOT mean "probability of success".
    # It describes how much evidence the backtest currently
    # contains.
    # --------------------------------------------------------

    if (
        test_trades >= 100
        and win_rate_gap is not None
        and win_rate_gap <= 10
    ):

        coverage = "HIGH"

    elif (
        test_trades >= 50
        and win_rate_gap is not None
        and win_rate_gap <= 15
    ):

        coverage = "MEDIUM"

    else:

        coverage = "LIMITED"

    # --------------------------------------------------------
    # Expectancy consistency
    # --------------------------------------------------------

    if (
        train_expectancy is not None
        and test_expectancy is not None
    ):

        if (
            train_expectancy > 0
            and test_expectancy > 0
        ):

            expectancy_consistency = (
                "POSITIVE IN BOTH PERIODS"
            )

        elif (
            train_expectancy > 0
            and test_expectancy <= 0
        ):

            expectancy_consistency = (
                "DETERIORATED OUT-OF-SAMPLE"
            )

        else:

            expectancy_consistency = (
                "NOT POSITIVE IN DEVELOPMENT PERIOD"
            )

    else:

        expectancy_consistency = (
            "INSUFFICIENT TRADE DATA"
        )

    return {
        "evidence_coverage": coverage,

        "train_test_win_rate_gap_pct": (
            win_rate_gap
        ),

        "expectancy_consistency": (
            expectancy_consistency
        ),

        "important_note": (
            "Historical win rate is a historical "
            "descriptive statistic, not a forecast "
            "of the next trade."
        ),

        "robustness_status": (
            "BASIC HOLDOUT TEST ONLY"
        ),
    }


# ============================================================
# RISK GUARDRAIL
# ============================================================

def calculate_risk_guardrail(
    metrics: dict[str, Any],
    strategy: dict[str, Any],
) -> dict[str, Any]:

    configured_risk_pct = float(
        strategy.get(
            "risk",
            {},
        ).get(
            "configured_risk_pct",
            1.0,
        )
    )

    max_losing_streak = int(
        metrics[
            "max_losing_streak"
        ]
    )

    max_drawdown_r = abs(
        float(
            metrics[
                "max_drawdown_r"
            ]
        )
    )

    # This is a descriptive calculator based on the user's
    # own configured risk. It is NOT a recommended risk level.

    historical_streak_loss_pct = (
        max_losing_streak
        * configured_risk_pct
    )

    historical_drawdown_loss_pct = (
        max_drawdown_r
        * configured_risk_pct
    )

    return {
        "configured_risk_per_trade_pct": round(
            configured_risk_pct,
            4,
        ),

        "historical_max_losing_streak": (
            max_losing_streak
        ),

        "illustrative_loss_from_max_streak_pct": round(
            historical_streak_loss_pct,
            4,
        ),

        "historical_max_drawdown_r": round(
            max_drawdown_r,
            4,
        ),

        "illustrative_drawdown_at_configured_risk_pct": round(
            historical_drawdown_loss_pct,
            4,
        ),

        "note": (
            "The platform does not infer an appropriate "
            "risk percentage from win rate. This calculation "
            "only shows what the selected user-defined risk "
            "would have implied during historical drawdowns."
        ),
    }


# ============================================================
# CURRENT SETUP MATCH
# ============================================================

def evaluate_current_setup(
    data: pd.DataFrame,
    strategy: dict[str, Any],
) -> dict[str, Any]:

    row = data.iloc[
        -1
    ]

    config = strategy[
        "entry"
    ]

    checks: list[
        dict[str, Any]
    ] = []

    # Price > VWAP
    if config.get(
        "price_above_vwap",
        False,
    ):

        checks.append(
            {
                "name": "Price above VWAP",
                "passed": (
                    float(
                        row["Close"]
                    )
                    > float(
                        row["VWAP"]
                    )
                ),
            }
        )

    # Price > EMA20
    if config.get(
        "price_above_ema20",
        False,
    ):

        checks.append(
            {
                "name": "Price above EMA20",
                "passed": (
                    float(
                        row["Close"]
                    )
                    > float(
                        row["EMA20"]
                    )
                ),
            }
        )

    # EMA20 > EMA50
    if config.get(
        "ema20_above_ema50",
        False,
    ):

        checks.append(
            {
                "name": "EMA20 above EMA50",
                "passed": (
                    float(
                        row["EMA20"]
                    )
                    > float(
                        row["EMA50"]
                    )
                ),
            }
        )

    # RSI
    rsi_value = float(
        row["RSI"]
    )

    rsi_min = float(
        config.get(
            "rsi_min",
            0,
        )
    )

    rsi_max = float(
        config.get(
            "rsi_max",
            100,
        )
    )

    checks.append(
        {
            "name": "RSI range",
            "passed": (
                rsi_min
                <= rsi_value
                <= rsi_max
            ),
        }
    )

    # Volume
    volume_ratio = float(
        row["VOLUME_RATIO"]
    )

    volume_min = float(
        config.get(
            "volume_ratio_min",
            0,
        )
    )

    checks.append(
        {
            "name": "Volume ratio",
            "passed": (
                volume_ratio
                >= volume_min
            ),
        }
    )

    passed_count = sum(
        1
        for check in checks
        if check["passed"]
    )

    total_count = len(
        checks
    )

    match_pct = (
        passed_count
        / total_count
        * 100
        if total_count
        else 0
    )

    return {
        "match_pct": round(
            match_pct,
            2,
        ),

        "conditions_passed": (
            passed_count
        ),

        "conditions_total": (
            total_count
        ),

        "all_conditions_pass": (
            passed_count
            == total_count
        ),

        "conditions": checks,

        "price": round(
            float(
                row["Close"]
            ),
            2,
        ),

        "rsi": round(
            rsi_value,
            2,
        ),

        "volume_ratio": round(
            volume_ratio,
            2,
        ),

        "note": (
            "Current setup match is the percentage "
            "of configured rules currently satisfied. "
            "It is not a probability of trade success."
        ),
    }


# ============================================================
# COMPLETE STRATEGY ANALYSIS
# ============================================================

def analyze_strategy(
    data: pd.DataFrame,
    strategy: dict[str, Any],
) -> dict[str, Any]:

    frame = prepare_ohlcv(
        data
    )

    frame = add_indicators(
        frame
    )

    # --------------------------------------------------------
    # Chronological holdout
    #
    # Development = first 70%
    # Out-of-sample = final 30%
    # --------------------------------------------------------

    split_index = int(
        len(frame)
        * 0.70
    )

    if split_index < 1:
        raise ValueError(
            "Not enough data for train/test split."
        )

    train_end = split_index

    train_trades = (
        run_backtest_segment(
            frame,
            strategy,
            0,
            train_end,
        )
    )

    test_trades = (
        run_backtest_segment(
            frame,
            strategy,
            train_end,
            len(frame),
        )
    )

    train_metrics = (
        calculate_metrics(
            train_trades
        )
    )

    test_metrics = (
        calculate_metrics(
            test_trades
        )
    )

    combined_trades = (
        train_trades
        + test_trades
    )

    combined_metrics = (
        calculate_metrics(
            combined_trades
        )
    )

    quantitative_analysis = (
        analyze_trade_quant_metrics(
            combined_trades,
            strategy,
        )
    )

    evidence = (
        evidence_summary(
            train_metrics,
            test_metrics,
        )
    )

    risk_guardrail = (
        calculate_risk_guardrail(
            combined_metrics,
            strategy,
        )
    )

    current_setup = (
        evaluate_current_setup(
            frame,
            strategy,
        )
    )

    return {
        "strategy": {
            "name": strategy.get(
                "name"
            ),
            "direction": strategy.get(
                "direction"
            ),
        },

        "data": {
            "candles": len(frame),
            "development_candles": (
                train_end
            ),
            "out_of_sample_candles": (
                len(frame)
                - train_end
            ),

            "development_period": {
                "start": str(
                    frame.index[0]
                ),
                "end": str(
                    frame.index[
                        train_end - 1
                    ]
                ),
            },

            "out_of_sample_period": {
                "start": str(
                    frame.index[
                        train_end
                    ]
                ),
                "end": str(
                    frame.index[-1]
                ),
            },
        },

        "development": train_metrics,

        "out_of_sample": test_metrics,

        "combined": combined_metrics,

        "quantitative_analysis": (
            quantitative_analysis
        ),

        "evidence": evidence,

        "risk_guardrail": (
            risk_guardrail
        ),

        "current_setup": (
            current_setup
        ),

        "trades": {
            "development": train_trades,
            "out_of_sample": test_trades,
        },

        "limitations": [
            "This is a basic chronological holdout test.",
            "It does not yet perform walk-forward validation.",
            "It does not yet perform parameter robustness testing.",
            "Historical results are not a guarantee of future results.",
            "The same-bar stop/target conflict is handled conservatively by assuming the stop is hit first.",
            "Monte Carlo paths resample historical net-R outcomes with replacement and do not model serial dependence or future regime changes.",
            "Sharpe and Sortino are reported per trade and are not annualized.",
            "Kelly outputs are mathematical calculations, not recommended risk settings.",
        ],
    }