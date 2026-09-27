from __future__ import annotations

import os
import sys

import pandas as pd
from dotenv import load_dotenv

from providers.upstox import UpstoxProvider
from strategy_engine import (
    DEFAULT_STRATEGY,
    analyze_strategy,
)


# ============================================================
# LOAD TOKEN
# ============================================================

load_dotenv(
    "backend/.env"
)

token = os.getenv(
    "UPSTOX_ANALYTICS_TOKEN"
)

if not token:

    print(
        "ERROR: UPSTOX_ANALYTICS_TOKEN "
        "not found."
    )

    sys.exit(1)


# ============================================================
# UPSTOX
# ============================================================

provider = UpstoxProvider(
    token
)

instrument = (
    provider.resolve_instrument(
        "RELIANCE"
    )
)

instrument_key = (
    instrument[
        "instrument_key"
    ]
)

print("=" * 70)
print(
    "WOWMAZING STRATEGY EVIDENCE ENGINE TEST"
)
print("=" * 70)
print()

print(
    "Instrument:",
    instrument_key
)

print()


# ============================================================
# GET 15-MINUTE CANDLES
# ============================================================

candles = provider.get_candles(
    instrument_key,
    "15m",
)

if len(candles) < 100:

    print(
        "ERROR: Not enough candles:",
        len(candles),
    )

    sys.exit(1)


# ============================================================
# CONVERT TO DATAFRAME
# ============================================================

rows = []

for candle in candles:

    if len(candle) < 6:
        continue

    rows.append(
        {
            "timestamp": candle[0],
            "Open": candle[1],
            "High": candle[2],
            "Low": candle[3],
            "Close": candle[4],
            "Volume": candle[5],
        }
    )


data = pd.DataFrame(
    rows
)

data["timestamp"] = pd.to_datetime(
    data["timestamp"],
    utc=True,
)

data["timestamp"] = (
    data["timestamp"]
    .dt.tz_convert(
        "Asia/Kolkata"
    )
)

data.set_index(
    "timestamp",
    inplace=True,
)

print(
    "Candles loaded:",
    len(data),
)

print()


# ============================================================
# RUN ENGINE
# ============================================================

result = analyze_strategy(
    data,
    DEFAULT_STRATEGY,
)


# ============================================================
# DISPLAY
# ============================================================

print(
    "STRATEGY:",
    result[
        "strategy"
    ]["name"],
)

print()

print(
    "----- DEVELOPMENT -----"
)

development = (
    result[
        "development"
    ]
)

print(
    "Trades:",
    development[
        "trades"
    ],
)

print(
    "Win rate:",
    development[
        "win_rate_pct"
    ],
    "%",
)

print(
    "Expectancy:",
    development[
        "expectancy_r"
    ],
    "R",
)

print(
    "Max losing streak:",
    development[
        "max_losing_streak"
    ],
)

print()


print(
    "----- OUT OF SAMPLE -----"
)

oos = (
    result[
        "out_of_sample"
    ]
)

print(
    "Trades:",
    oos[
        "trades"
    ],
)

print(
    "Win rate:",
    oos[
        "win_rate_pct"
    ],
    "%",
)

print(
    "Expectancy:",
    oos[
        "expectancy_r"
    ],
    "R",
)

print(
    "Max losing streak:",
    oos[
        "max_losing_streak"
    ],
)

print()


print(
    "----- COMBINED -----"
)

combined = (
    result[
        "combined"
    ]
)

print(
    "Trades:",
    combined[
        "trades"
    ],
)

print(
    "Win rate:",
    combined[
        "win_rate_pct"
    ],
    "%",
)

print(
    "Loss rate:",
    combined[
        "loss_rate_pct"
    ],
    "%",
)

print(
    "Expectancy:",
    combined[
        "expectancy_r"
    ],
    "R",
)

print(
    "Profit factor:",
    combined[
        "profit_factor"
    ],
)

print(
    "Max losing streak:",
    combined[
        "max_losing_streak"
    ],
)

print(
    "Max drawdown:",
    combined[
        "max_drawdown_r"
    ],
    "R",
)

print()


print(
    "----- EVIDENCE -----"
)

evidence = (
    result[
        "evidence"
    ]
)

print(
    "Evidence coverage:",
    evidence[
        "evidence_coverage"
    ],
)

print(
    "Train/OOS win-rate gap:",
    evidence[
        "train_test_win_rate_gap_pct"
    ],
    "%",
)

print(
    "Expectancy consistency:",
    evidence[
        "expectancy_consistency"
    ],
)

print(
    "Robustness:",
    evidence[
        "robustness_status"
    ],
)

print()


print(
    "----- CURRENT SETUP -----"
)

current = (
    result[
        "current_setup"
    ]
)

print(
    "Current rule match:",
    current[
        "match_pct"
    ],
    "%",
)

print(
    "Conditions:",
    current[
        "conditions_passed"
    ],
    "/",
    current[
        "conditions_total"
    ],
)

print(
    "All conditions pass:",
    current[
        "all_conditions_pass"
    ],
)

print()


print(
    "----- RISK GUARDRAIL -----"
)

risk = (
    result[
        "risk_guardrail"
    ]
)

print(
    "Configured risk:",
    risk[
        "configured_risk_per_trade_pct"
    ],
    "%",
)

print(
    "Historical max losing streak:",
    risk[
        "historical_max_losing_streak"
    ],
)

print(
    "Illustrative loss at configured risk:",
    risk[
        "illustrative_loss_from_max_streak_pct"
    ],
    "%",
)

print()


print("=" * 70)
print(
    "STRATEGY EVIDENCE ENGINE TEST COMPLETE"
)
print("=" * 70)