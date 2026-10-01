from __future__ import annotations

import json
import math
import os
import re
from functools import lru_cache
from pathlib import Path
from typing import Any
from urllib.parse import urlsplit

import numpy as np
import pandas as pd
import yfinance as yf
from dotenv import load_dotenv
from fastapi import FastAPI, HTTPException, Query
from fastapi.middleware.cors import CORSMiddleware
from openai import OpenAI
from pydantic import BaseModel, Field

from backend.providers.upstox import (
    SUPPORTED_TIMEFRAMES,
    UpstoxProvider,
    UpstoxProviderError,
)

from backend.strategy_engine import (
    DEFAULT_STRATEGY,
    analyze_strategy,
)
from backend.fundamentals import (
    get_fundamentals,
)


# ============================================================
# ENVIRONMENT
# ============================================================

BASE_DIR = Path(__file__).resolve().parent

load_dotenv(
    BASE_DIR / ".env"
)

MARKET_DATA_PROVIDER = os.getenv(
    "MARKET_DATA_PROVIDER",
    "upstox",
).strip().lower()

ALLOW_YFINANCE_FALLBACK = (
    os.getenv(
        "ALLOW_YFINANCE_FALLBACK",
        "true",
    ).strip().lower()
    in {
        "1",
        "true",
        "yes",
        "on",
    }
)

DEFAULT_CORS_ORIGINS = (
    "http://localhost:1420",
    "http://127.0.0.1:1420",
    "tauri://localhost",
    "http://tauri.localhost",
)


def configured_cors_origins() -> list[str]:
    """Return explicit browser origins, using local-only defaults if unset."""

    configured = os.getenv("CORS_ORIGINS")
    if configured is None:
        return list(DEFAULT_CORS_ORIGINS)

    origins: list[str] = []
    for value in configured.split(","):
        origin = value.strip().rstrip("/")
        if not origin:
            continue

        parsed = urlsplit(origin)
        try:
            valid_port = parsed.port is None or 0 < parsed.port <= 65535
        except ValueError:
            valid_port = False

        if (
            origin == "*"
            or parsed.scheme.lower() not in {"http", "https", "tauri"}
            or not parsed.hostname
            or "*" in parsed.netloc
            or parsed.username is not None
            or parsed.password is not None
            or parsed.path
            or parsed.query
            or parsed.fragment
            or not valid_port
        ):
            raise ValueError(
                "CORS_ORIGINS must contain comma-separated origins only "
                "(for example https://market.example.com); wildcard origins "
                "and URL paths are not allowed."
            )

        if origin not in origins:
            origins.append(origin)

    return origins


CORS_ORIGINS = configured_cors_origins()


# ============================================================
# FASTAPI
# ============================================================

app = FastAPI(
    title="WOWMAZING Market Agent API",
    description=(
        "Market research backend for "
        "WOWMAZING Market Agent V1"
    ),
    version="0.4.0",
)


app.add_middleware(
    CORSMiddleware,
    allow_origins=CORS_ORIGINS,
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


# ============================================================
# TIMEFRAME CONFIGURATION
# ============================================================
#
# "display_interval" is the requested WOWMAZING timeframe.
#
# "yf_interval" and "yf_period" are only used by the
# development fallback provider.
#
# Upstox is the primary market-data provider.
# ============================================================

TIMEFRAME_MAP = {
    "1m": {
        "display_interval": "1m",
        "yf_interval": "1m",
        "yf_period": "7d",
    },
    "3m": {
        "display_interval": "3m",
        "yf_interval": "5m",
        "yf_period": "60d",
    },
    "5m": {
        "display_interval": "5m",
        "yf_interval": "5m",
        "yf_period": "60d",
    },
    "15m": {
        "display_interval": "15m",
        "yf_interval": "15m",
        "yf_period": "60d",
    },
    "30m": {
        "display_interval": "30m",
        "yf_interval": "30m",
        "yf_period": "60d",
    },
    "1H": {
        "display_interval": "1H",
        "yf_interval": "1h",
        "yf_period": "1y",
    },
    "4H": {
        "display_interval": "4H",
        "yf_interval": "1h",
        "yf_period": "1y",
    },
    "1D": {
        "display_interval": "1D",
        "yf_interval": "1d",
        "yf_period": "2y",
    },
    "1W": {
        "display_interval": "1W",
        "yf_interval": "1wk",
        "yf_period": "5y",
    },
}


# ============================================================
# YFINANCE SYMBOL FALLBACKS
# ============================================================

YFINANCE_SYMBOL_MAP = {
    "NIFTY": "^NSEI",
    "NIFTY50": "^NSEI",
    "NIFTY 50": "^NSEI",
    "BANKNIFTY": "^NSEBANK",
    "BANK NIFTY": "^NSEBANK",
    "NIFTY BANK": "^NSEBANK",
}


# ============================================================
# REQUEST / RESPONSE MODELS
# ============================================================

class AgentRequest(BaseModel):
    command: str
    symbol: str = "RELIANCE.NS"
    timeframe: str = "15m"
    market: str = "INDIA"


class AgentMarketView(BaseModel):
    bias: str = "NEUTRAL"
    title: str = "Neutral / mixed"
    summary: str = ""


class AgentSetupStatus(BaseModel):
    status: str = "WAIT"
    technical_evidence_strength: float | None = None
    technical_evidence_basis: str = (
        "Derived only from the deterministic technical directional score; fundamentals are not included."
    )


class AgentTechnicalRead(BaseModel):
    rsi: float | None = None
    vwap: float | None = None
    ema20: float | None = None
    atr: float | None = None
    macd: float | None = None
    volume_ratio: float | None = None
    price_vs_vwap_pct: float | None = None
    price_vs_ema20_pct: float | None = None
    ema20_vs_ema50_pct: float | None = None


class AgentFundamentalContext(BaseModel):
    name: str | None = None
    provider: str | None = None
    currency: str | None = None
    trailing_pe: float | None = None
    trailing_eps: float | None = None
    revenue_growth: float | None = None
    market_cap: float | None = None
    dividend_yield: float | None = None


class AgentRisk(BaseModel):
    title: str = "Risk / invalidation"
    summary: str = ""
    invalidation: list[str] = Field(default_factory=list)


class AgentContext(BaseModel):
    provider: str = "Unknown"
    timeframe: str = "—"
    exchange: str = "—"
    latest_candle_timestamp: str | None = None
    market: str = "—"


class AgentBrief(BaseModel):
    version: str = "1.0"
    market_view: AgentMarketView
    setup_status: AgentSetupStatus
    technical_read: AgentTechnicalRead
    fundamental_context: AgentFundamentalContext
    catalysts: list[str] = Field(default_factory=list)
    risk: AgentRisk
    context: AgentContext


class AgentResponse(BaseModel):
    success: bool
    answer: str
    market_snapshot: dict[str, Any]
    fundamentals: dict[str, Any] | None = None
    brief: AgentBrief | None = None
    ai_used: bool
    error: str | None = None


# ============================================================
# DATA HELPERS
# ============================================================

def normalize_symbol(
    symbol: str,
) -> str:

    symbol = symbol.strip().upper()

    if not symbol:

        raise ValueError(
            "A stock or index symbol is required."
        )

    return symbol


def get_timeframe_config(
    timeframe: str,
) -> dict[str, str]:

    if timeframe not in TIMEFRAME_MAP:

        raise ValueError(
            f"Unsupported timeframe: {timeframe}. "
            f"Supported: {', '.join(TIMEFRAME_MAP)}"
        )

    return TIMEFRAME_MAP[timeframe]


def clean_dataframe(
    data: pd.DataFrame,
) -> pd.DataFrame:

    if isinstance(
        data.columns,
        pd.MultiIndex,
    ):

        data.columns = (
            data.columns
            .get_level_values(0)
        )

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
            "Missing market columns: "
            + ", ".join(missing)
        )

    data = data[
        required
    ].copy()

    for column in required:

        data[column] = pd.to_numeric(
            data[column],
            errors="coerce",
        )

    data.dropna(
        subset=[
            "Open",
            "High",
            "Low",
            "Close",
        ],
        inplace=True,
    )

    data["Volume"] = (
        data["Volume"]
        .fillna(0)
    )

    data = data[
        ~data.index.duplicated(
            keep="last"
        )
    ]

    data.sort_index(
        inplace=True
    )

    if data.empty:

        raise ValueError(
            "Market data is empty."
        )

    return data


def candles_to_dataframe(
    candles: list[list[Any]],
) -> pd.DataFrame:

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

    if not rows:

        raise ValueError(
            "Upstox returned no valid OHLCV candles."
        )

    data = pd.DataFrame(rows)

    data["timestamp"] = pd.to_datetime(
        data["timestamp"],
        utc=True,
        errors="coerce",
    )

    data.dropna(
        subset=["timestamp"],
        inplace=True,
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

    return clean_dataframe(
        data
    )


# ============================================================
# UPSTOX PROVIDER
# ============================================================

@lru_cache(maxsize=1)
def get_upstox_provider() -> UpstoxProvider:

    token = os.getenv(
        "UPSTOX_ANALYTICS_TOKEN"
    )

    if not token:

        raise UpstoxProviderError(
            "UPSTOX_ANALYTICS_TOKEN is not configured "
            "in backend/.env"
        )

    return UpstoxProvider(
        access_token=token
    )


# ============================================================
# YFINANCE FALLBACK
# ============================================================

def normalize_yfinance_symbol(
    symbol: str,
) -> str:

    normalized = normalize_symbol(
        symbol
    )

    mapped = YFINANCE_SYMBOL_MAP.get(
        normalized
    )

    if mapped:
        return mapped

    return normalized


def yfinance_symbol_candidates(
    symbol: str,
    market: str = "INDIA",
) -> list[str]:
    """Return ordered Yahoo Finance candidates for the selected market.

    GLOBAL explicitly uses the exact Yahoo symbol and never tries an
    NSE .NS variant first. This prevents AAPL from resolving to AAPL.NS.
    """

    normalized = normalize_yfinance_symbol(
        symbol
    )

    selected_market = market.strip().upper()

    if normalized.startswith("^"):
        return [normalized]

    if selected_market == "GLOBAL":
        return [normalized]

    if normalized.endswith(".BO"):
        return [normalized]

    if normalized.endswith(".NS"):
        base = normalized[:-3]
        return [normalized, base]

    if "." in normalized:
        return [normalized]

    return [
        f"{normalized}.NS",
        normalized,
    ]


def download_yfinance_market_data(
    symbol: str,
    timeframe: str,
    market: str = "INDIA",
) -> tuple[pd.DataFrame, str]:

    config = get_timeframe_config(
        timeframe
    )

    candidates = yfinance_symbol_candidates(
        symbol,
        market,
    )

    last_error: Exception | None = None

    for yf_symbol in candidates:
        try:
            data = yf.download(
                yf_symbol,
                period=config["yf_period"],
                interval=config["yf_interval"],
                auto_adjust=True,
                progress=False,
            )

            data = clean_dataframe(
                data
            )

            if len(data) >= 60:
                return data, yf_symbol

        except Exception as error:
            last_error = error

    detail = (
        str(last_error)
        if last_error is not None
        else "No usable Yahoo Finance symbol was found."
    )

    raise ValueError(
        "Not enough historical data from "
        f"the yfinance fallback for '{symbol}'. "
        f"Tried: {', '.join(candidates)}. "
        f"Details: {detail}"
    )


def infer_yfinance_currency(
    symbol: str,
    exchange: str = "",
) -> str:
    """Best-effort currency when Yahoo omits currency in search results."""

    normalized = symbol.strip().upper()
    exchange_upper = exchange.strip().upper()

    suffix_currency = {
        ".TO": "CAD",
        ".V": "CAD",
        ".L": "GBP",
        ".DE": "EUR",
        ".PA": "EUR",
        ".MI": "EUR",
        ".AS": "EUR",
        ".T": "JPY",
        ".HK": "HKD",
        ".SI": "SGD",
        ".AX": "AUD",
        ".NS": "INR",
        ".BO": "INR",
    }

    for suffix, currency in suffix_currency.items():
        if normalized.endswith(suffix):
            return currency

    if exchange_upper in {
        "NASDAQ",
        "NYSE",
        "NYSEARCA",
        "NYSE ARCA",
        "AMEX",
        "BATS",
        "CBOE",
    }:
        return "USD"

    return ""


# ============================================================
# MARKET DATA LOADER
# ============================================================

def download_market_data(
    symbol: str,
    timeframe: str,
    market: str = "INDIA",
) -> tuple[
    pd.DataFrame,
    dict[str, Any],
    dict[str, Any] | None,
]:

    symbol = normalize_symbol(
        symbol
    )

    selected_market = market.strip().upper()

    if selected_market not in {
        "INDIA",
        "GLOBAL",
        "INDEX",
    }:
        raise ValueError(
            "market must be INDIA, GLOBAL or INDEX."
        )

    if timeframe not in SUPPORTED_TIMEFRAMES:
        raise ValueError(
            f"Unsupported timeframe: {timeframe}"
        )

    # --------------------------------------------------------
    # PRIMARY: UPSTOX FOR INDIA / INDEX ONLY
    # --------------------------------------------------------

    if (
        selected_market in {"INDIA", "INDEX"}
        and MARKET_DATA_PROVIDER != "yfinance"
    ):
        try:
            provider = get_upstox_provider()
            
            # Resolve dashboard index symbols directly to known Upstox index keys.
            index_instrument_keys = {
                "NIFTY 50": "NSE_INDEX|Nifty 50",
                "NIFTY": "NSE_INDEX|Nifty 50",
                "^NSEI": "NSE_INDEX|Nifty 50",
                "BANKNIFTY": "NSE_INDEX|Nifty Bank",
                "BANK NIFTY": "NSE_INDEX|Nifty Bank",
                "NIFTY BANK": "NSE_INDEX|Nifty Bank",
                "^NSEBANK": "NSE_INDEX|Nifty Bank",
            }

            index_key = index_instrument_keys.get(symbol.upper())

            if selected_market == "INDEX" and index_key:
                display_name = (
                    "NIFTY 50"
                    if index_key == "NSE_INDEX|Nifty 50"
                    else "BANKNIFTY"
                )
                instrument = {
                    "instrument_key": index_key,
                    "trading_symbol": display_name,
                    "name": display_name,
                    "segment": "NSE_INDEX",
                }
            else:
                instrument = provider.resolve_instrument(symbol)

            candles = provider.get_candles(
                instrument["instrument_key"],
                timeframe,
            )

            data = candles_to_dataframe(candles)

            if len(data) < 60:
                raise UpstoxProviderError(
                    "Upstox returned fewer than 60 candles."
                )

            quote = provider.get_quote(
                instrument["instrument_key"]
            )

            metadata = {
                "provider": "upstox",
                "requested_symbol": symbol,
                "resolved_symbol": (
                    instrument.get("trading_symbol")
                    or instrument.get("name")
                    or symbol
                ),
                "instrument_key": instrument.get("instrument_key"),
                "segment": instrument.get("segment"),
                "timeframe": timeframe,
                "market": selected_market,
                "currency": "INR",
                "exchange": (
                    "INDEX"
                    if selected_market == "INDEX"
                    else "NSE"
                ),
                "note": "Upstox read-only market data.",
            }

            return data, metadata, quote

        except Exception as error:
            print("Upstox market-data error:", error)

            if not ALLOW_YFINANCE_FALLBACK:
                raise

    # --------------------------------------------------------
    # GLOBAL / FALLBACK: YFINANCE
    # --------------------------------------------------------

    data, resolved_yf_symbol = download_yfinance_market_data(
        symbol,
        timeframe,
        selected_market,
    )

    inferred_currency = infer_yfinance_currency(
        resolved_yf_symbol,
    )

    # Plain global Yahoo symbols such as AAPL do not always expose
    # currency metadata. In this app, GLOBAL search resolves those
    # ordinary US-listed symbols through Yahoo Finance, so use USD
    # as the backend fallback when Yahoo omitted the field.
    if not inferred_currency and selected_market == "GLOBAL":
        inferred_currency = "USD"

    metadata = {
        "provider": "yfinance_fallback",
        "requested_symbol": symbol,
        "resolved_symbol": resolved_yf_symbol,
        "instrument_key": None,
        "segment": None,
        "timeframe": timeframe,
        "market": selected_market,
        "currency": inferred_currency,
        "exchange": "Yahoo Finance",
        "note": (
            "Yahoo Finance market data. "
            "Used for global instruments or as the India fallback."
        ),
    }

    return data, metadata, None


# ============================================================
# INDICATORS
# ============================================================

def calculate_ema(
    close: pd.Series,
    period: int,
) -> pd.Series:

    return close.ewm(
        span=period,
        adjust=False,
    ).mean()


def calculate_rsi(
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

    rs = avg_gain / (
        avg_loss.replace(
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


def calculate_macd(
    close: pd.Series,
) -> tuple[
    pd.Series,
    pd.Series,
    pd.Series,
]:

    ema12 = calculate_ema(
        close,
        12,
    )

    ema26 = calculate_ema(
        close,
        26,
    )

    macd = (
        ema12 - ema26
    )

    signal = calculate_ema(
        macd,
        9,
    )

    histogram = (
        macd - signal
    )

    return (
        macd,
        signal,
        histogram,
    )


def calculate_atr(
    data: pd.DataFrame,
    period: int = 14,
) -> pd.Series:

    previous_close = (
        data["Close"].shift(1)
    )

    true_range = pd.concat(
        [
            (
                data["High"]
                - data["Low"]
            ),

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


def calculate_bollinger(
    close: pd.Series,
    period: int = 20,
) -> tuple[
    pd.Series,
    pd.Series,
    pd.Series,
]:

    middle = (
        close
        .rolling(period)
        .mean()
    )

    standard_deviation = (
        close
        .rolling(period)
        .std()
    )

    upper = (
        middle
        + (
            2
            * standard_deviation
        )
    )

    lower = (
        middle
        - (
            2
            * standard_deviation
        )
    )

    return (
        middle,
        upper,
        lower,
    )


def calculate_vwap(
    data: pd.DataFrame,
    timeframe: str,
) -> pd.Series:

    typical_price = (
        data["High"]
        + data["Low"]
        + data["Close"]
    ) / 3

    volume = data[
        "Volume"
    ]

    intraday_timeframes = {
        "1m",
        "3m",
        "5m",
        "15m",
        "30m",
        "1H",
        "4H",
    }

    if timeframe in intraday_timeframes:

        if isinstance(
            data.index,
            pd.DatetimeIndex,
        ):

            if data.index.tz is not None:

                local_index = (
                    data.index
                    .tz_convert(
                        "Asia/Kolkata"
                    )
                )

            else:

                local_index = (
                    data.index
                    .tz_localize(
                        "Asia/Kolkata"
                    )
                )

            dates = (
                local_index
                .normalize()
            )

            cumulative_pv = (
                typical_price * volume
            ).groupby(
                dates
            ).cumsum()

            cumulative_volume = (
                volume
                .groupby(
                    dates
                )
                .cumsum()
            )

            return (
                cumulative_pv
                / cumulative_volume.replace(
                    0,
                    np.nan,
                )
            )

    weighted_price = (
        typical_price * volume
    )

    rolling_pv = (
        weighted_price
        .rolling(20)
        .sum()
    )

    rolling_volume = (
        volume
        .rolling(20)
        .sum()
    )

    return (
        rolling_pv
        / rolling_volume.replace(
            0,
            np.nan,
        )
    )


# ============================================================
# MARKET ANALYSIS
# ============================================================

def build_market_analysis(
    data: pd.DataFrame,
    symbol: str,
    timeframe: str,
    metadata: dict[str, Any],
    quote: dict[str, Any] | None = None,
) -> dict[str, Any]:

    data = data.copy()

    close = data["Close"]

    # --------------------------------------------------------
    # Indicators
    # --------------------------------------------------------

    data["EMA20"] = calculate_ema(
        close,
        20,
    )

    data["EMA50"] = calculate_ema(
        close,
        50,
    )

    data["EMA200"] = calculate_ema(
        close,
        200,
    )

    data["RSI"] = calculate_rsi(
        close
    )

    (
        data["MACD"],
        data["MACD_SIGNAL"],
        data["MACD_HISTOGRAM"],
    ) = calculate_macd(
        close
    )

    data["ATR"] = calculate_atr(
        data
    )

    (
        data["BB_MIDDLE"],
        data["BB_UPPER"],
        data["BB_LOWER"],
    ) = calculate_bollinger(
        close
    )

    data["VWAP"] = calculate_vwap(
        data,
        timeframe,
    )

    data["VOLUME_AVG20"] = (
        data["Volume"]
        .rolling(20)
        .mean()
    )

    # --------------------------------------------------------
    # Latest candle
    # --------------------------------------------------------

    latest = data.iloc[-1]
    previous = data.iloc[-2]

    candle_price = float(
        latest["Close"]
    )

    previous_candle_close = float(
        previous["Close"]
    )

    # --------------------------------------------------------
    # Current quote
    #
    # When Upstox is active, use the latest quote price for
    # the dashboard price. Indicators remain calculated from
    # the candle series.
    # --------------------------------------------------------

    quote_price = None
    quote_previous_close = None

    if quote:

        try:

            quote_price = float(
                quote.get(
                    "last_price"
                )
            )

        except (
            TypeError,
            ValueError,
        ):

            quote_price = None

        try:

            quote_previous_close = float(
                quote.get(
                    "prev_close_price"
                )
            )

        except (
            TypeError,
            ValueError,
        ):

            quote_previous_close = None

    price = (
        quote_price
        if quote_price is not None
        and quote_price > 0
        else candle_price
    )

    previous_close = (
        quote_previous_close
        if quote_previous_close is not None
        and quote_previous_close > 0
        else previous_candle_close
    )

    change = (
        price
        - previous_close
    )

    change_pct = (
        change
        / previous_close
        * 100
        if previous_close != 0
        else 0.0
    )

    # --------------------------------------------------------
    # Indicator values
    # --------------------------------------------------------

    ema20 = float(
        latest["EMA20"]
    )

    ema50 = float(
        latest["EMA50"]
    )

    ema200 = float(
        latest["EMA200"]
    )

    rsi = float(
        latest["RSI"]
    )

    macd = float(
        latest["MACD"]
    )

    macd_signal = float(
        latest["MACD_SIGNAL"]
    )

    macd_histogram = float(
        latest["MACD_HISTOGRAM"]
    )

    atr = float(
        latest["ATR"]
    )

    bb_middle = float(
        latest["BB_MIDDLE"]
    )

    bb_upper = float(
        latest["BB_UPPER"]
    )

    bb_lower = float(
        latest["BB_LOWER"]
    )

    vwap = float(
        latest["VWAP"]
    )

    volume_avg20 = float(
        latest["VOLUME_AVG20"]
    )

    current_volume = float(
        latest["Volume"]
    )

    volume_ratio = (
        current_volume
        / volume_avg20
        if volume_avg20 > 0
        else 1.0
    )

    # --------------------------------------------------------
    # Support / resistance
    # --------------------------------------------------------

    recent = data.tail(20)

    support = float(
        recent["Low"].min()
    )

    resistance = float(
        recent["High"].max()
    )

    # --------------------------------------------------------
    # BULL / BEAR SCORING
    # --------------------------------------------------------

    bullish_score = 0
    bearish_score = 0

    reasons: list[str] = []

    # EMA20
    if price > ema20:

        bullish_score += 1

        reasons.append(
            "Price is above EMA20."
        )

    else:

        bearish_score += 1

        reasons.append(
            "Price is below EMA20."
        )

    # EMA20 vs EMA50
    if ema20 > ema50:

        bullish_score += 1

        reasons.append(
            "EMA20 is above EMA50."
        )

    else:

        bearish_score += 1

        reasons.append(
            "EMA20 is below EMA50."
        )

    # RSI
    if rsi >= 55:

        bullish_score += 2

        reasons.append(
            "RSI supports bullish momentum."
        )

    elif rsi <= 45:

        bearish_score += 2

        reasons.append(
            "RSI indicates weaker momentum."
        )

    # MACD
    if macd > macd_signal:

        bullish_score += 2

        reasons.append(
            "MACD is above its signal line."
        )

    else:

        bearish_score += 2

        reasons.append(
            "MACD is below its signal line."
        )

    # VWAP
    if not math.isnan(vwap):

        if price > vwap:

            bullish_score += 1

            reasons.append(
                "Price is above VWAP."
            )

        else:

            bearish_score += 1

            reasons.append(
                "Price is below VWAP."
            )

    # Bollinger middle
    if not math.isnan(
        bb_middle
    ):

        if price > bb_middle:

            bullish_score += 1

        else:

            bearish_score += 1

    # Volume
    if volume_ratio >= 1.20:

        if price >= ema20:

            bullish_score += 1

        else:

            bearish_score += 1

    # --------------------------------------------------------
    # Final state
    # --------------------------------------------------------

    if (
        bullish_score >= 7
        and bullish_score > bearish_score
    ):

        signal = "BUY BIAS"
        trend = "BULLISH"

    elif (
        bearish_score >= 7
        and bearish_score > bullish_score
    ):

        signal = "SELL BIAS"
        trend = "BEARISH"

    else:

        signal = "WAIT"

        if bullish_score > bearish_score:

            trend = "BULLISH"

        elif bearish_score > bullish_score:

            trend = "BEARISH"

        else:

            trend = "MIXED"

    # --------------------------------------------------------
    # Safe serialization
    # --------------------------------------------------------

    def finite(
        value: Any,
        digits: int = 4,
    ) -> float | None:

        try:

            numeric = float(value)

        except (
            TypeError,
            ValueError,
        ):

            return None

        if math.isnan(
            numeric
        ):

            return None

        if math.isinf(
            numeric
        ):

            return None

        return round(
            numeric,
            digits,
        )

    candles = []

    for timestamp, row in data.tail(
        200
    ).iterrows():

        if isinstance(
            timestamp,
            pd.Timestamp,
        ):

            unix_time = int(
                timestamp.timestamp()
            )

        else:

            continue

        candles.append(
            {
                "time": unix_time,
                "open": round(
                    float(row["Open"]),
                    2,
                ),
                "high": round(
                    float(row["High"]),
                    2,
                ),
                "low": round(
                    float(row["Low"]),
                    2,
                ),
                "close": round(
                    float(row["Close"]),
                    2,
                ),
                "volume": round(
                    float(row["Volume"]),
                    2,
                ),
            }
        )

    def series(
        column: str,
        digits: int = 4,
    ) -> list[dict[str, Any]]:

        result = []

        for timestamp, value in (
            data[column]
            .tail(200)
            .items()
        ):

            if isinstance(
                timestamp,
                pd.Timestamp,
            ):

                unix_time = int(
                    timestamp.timestamp()
                )

            else:

                continue

            numeric = float(
                value
            )

            if math.isnan(
                numeric
            ):

                continue

            result.append(
                {
                    "time": unix_time,
                    "value": round(
                        numeric,
                        digits,
                    ),
                }
            )

        return result

    # --------------------------------------------------------
    # Market quote metadata
    # --------------------------------------------------------

    market_quote: dict[str, Any] = {}

    if quote:

        ohlc = (
            quote.get("ohlc")
            or {}
        )

        market_quote = {
            "last_price": finite(
                quote.get(
                    "last_price"
                ),
                2,
            ),
            "prev_close_price": finite(
                quote.get(
                    "prev_close_price"
                ),
                2,
            ),
            "open": finite(
                ohlc.get("open"),
                2,
            ),
            "high": finite(
                ohlc.get("high"),
                2,
            ),
            "low": finite(
                ohlc.get("low"),
                2,
            ),
            "close": finite(
                ohlc.get("close"),
                2,
            ),
            "volume": finite(
                ohlc.get("volume"),
                0,
            ),
            "timestamp": (
                ohlc.get("ts")
                or quote.get(
                    "timestamp"
                )
            ),
        }

    latest_timestamp = None

    if isinstance(
        data.index[-1],
        pd.Timestamp,
    ):

        latest_timestamp = (
            data.index[-1]
            .isoformat()
        )

    return {
        "symbol": symbol,
        "requested_symbol": metadata.get(
            "requested_symbol"
        ),
        "resolved_symbol": metadata.get(
            "resolved_symbol"
        ),
        "instrument_key": metadata.get(
            "instrument_key"
        ),
        "segment": metadata.get(
            "segment"
        ),
        "data_provider": metadata.get(
            "provider"
        ),
        "data_note": metadata.get(
            "note"
        ),
        "market": metadata.get(
            "market"
        ),
        "currency": metadata.get(
            "currency"
        ),
        "exchange": metadata.get(
            "exchange"
        ),
        "timeframe": timeframe,
        "interval": TIMEFRAME_MAP[
            timeframe
        ]["display_interval"],

        "price": round(
            price,
            2,
        ),

        "previous_close": round(
            previous_close,
            2,
        ),

        "change": round(
            change,
            2,
        ),

        "change_pct": round(
            change_pct,
            2,
        ),

        "trend": trend,
        "signal": signal,

        "bullish_score": bullish_score,
        "bearish_score": bearish_score,

        "rsi": finite(
            rsi
        ),

        "macd": finite(
            macd
        ),

        "macd_signal": finite(
            macd_signal
        ),

        "macd_histogram": finite(
            macd_histogram
        ),

        "ema20": finite(
            ema20
        ),

        "ema50": finite(
            ema50
        ),

        "ema200": finite(
            ema200
        ),

        "vwap": finite(
            vwap
        ),

        "atr": finite(
            atr
        ),

        "bollinger": {
            "middle": finite(
                bb_middle
            ),
            "upper": finite(
                bb_upper
            ),
            "lower": finite(
                bb_lower
            ),
        },

        "support": round(
            support,
            2,
        ),

        "resistance": round(
            resistance,
            2,
        ),

        "volume_ratio": round(
            volume_ratio,
            2,
        ),

        "reasons": reasons,

        "latest_candle_timestamp": (
            latest_timestamp
        ),

        "market_quote": (
            market_quote
        ),

        "candles": candles,

        "series": {
            "ema20": series(
                "EMA20"
            ),
            "ema50": series(
                "EMA50"
            ),
            "ema200": series(
                "EMA200"
            ),
            "vwap": series(
                "VWAP"
            ),
            "bb_middle": series(
                "BB_MIDDLE"
            ),
            "bb_upper": series(
                "BB_UPPER"
            ),
            "bb_lower": series(
                "BB_LOWER"
            ),
        },
    }


# ============================================================
# OPTIONAL AI EXPLANATION
# ============================================================

def _safe_float(value: Any) -> float | None:
    try:
        numeric = float(value)
    except (TypeError, ValueError):
        return None
    if not math.isfinite(numeric):
        return None
    return numeric


def _pct_delta(
    current: Any,
    reference: Any,
) -> float | None:
    current_value = _safe_float(current)
    reference_value = _safe_float(reference)
    if current_value is None or reference_value in (None, 0):
        return None
    return round(
        ((current_value - reference_value) / reference_value) * 100,
        4,
    )


def _extract_json_object(text: str) -> dict[str, Any] | None:
    """Extract the first valid JSON object from an LLM response."""
    if not text:
        return None

    cleaned = text.strip()

    fenced = re.search(
        r"```(?:json)?\s*(\{.*?\})\s*```",
        cleaned,
        flags=re.IGNORECASE | re.DOTALL,
    )
    candidates: list[str] = []
    if fenced:
        candidates.append(fenced.group(1))

    decoder = json.JSONDecoder()
    for match in re.finditer(r"\{", cleaned):
        try:
            payload, _ = decoder.raw_decode(cleaned[match.start():])
        except json.JSONDecodeError:
            continue
        if isinstance(payload, dict):
            candidates.append(json.dumps(payload))
            break

    for candidate in candidates:
        try:
            value = json.loads(candidate)
        except json.JSONDecodeError:
            continue
        if isinstance(value, dict):
            return value

    return None


def _clean_string_list(value: Any, limit: int = 6) -> list[str]:
    if not isinstance(value, list):
        return []
    result: list[str] = []
    for item in value:
        text = str(item).strip()
        if text:
            result.append(text)
        if len(result) >= limit:
            break
    return result


def build_agent_brief(
    analysis: dict[str, Any],
    fundamentals: dict[str, Any] | None,
    ai_payload: dict[str, Any] | None = None,
) -> AgentBrief:
    """
    Build the structured agent brief.

    Numeric/market/fundamental fields remain source-locked to the deterministic
    engines. The AI payload can contribute narrative wording, catalysts and
    risk language, but cannot override source values or create a combined score.
    """
    fundamentals = fundamentals or {}
    ai_payload = ai_payload or {}

    trend = str(analysis.get("trend") or "MIXED").upper()
    bias = (
        "BULLISH"
        if trend == "BULLISH"
        else "BEARISH"
        if trend == "BEARISH"
        else "NEUTRAL"
    )

    bullish_score = _safe_float(analysis.get("bullish_score")) or 0.0
    bearish_score = _safe_float(analysis.get("bearish_score")) or 0.0
    technical_evidence_strength = round(
        max(0.0, min(10.0, max(bullish_score, bearish_score))),
        1,
    )

    ai_market = ai_payload.get("market_view")
    if not isinstance(ai_market, dict):
        ai_market = {}

    ai_setup = ai_payload.get("setup_status")
    if not isinstance(ai_setup, dict):
        ai_setup = {}

    ai_risk = ai_payload.get("risk")
    if not isinstance(ai_risk, dict):
        ai_risk = {}

    ai_technical = ai_payload.get("technical_read")
    if not isinstance(ai_technical, dict):
        ai_technical = {}

    ai_fundamentals = ai_payload.get("fundamental_context")
    if not isinstance(ai_fundamentals, dict):
        ai_fundamentals = {}

    ai_context = ai_payload.get("context")
    if not isinstance(ai_context, dict):
        ai_context = {}

    reasons = analysis.get("reasons") or []
    if not isinstance(reasons, list):
        reasons = []

    catalysts = _clean_string_list(ai_payload.get("catalysts"))
    if not catalysts:
        catalysts = _clean_string_list(reasons, limit=4)

    support = analysis.get("support")
    resistance = analysis.get("resistance")
    atr = analysis.get("atr")

    invalidation = _clean_string_list(ai_risk.get("invalidation"), limit=4)
    if not invalidation:
        invalidation = [
            (
                f"Support reference: {support}"
                if support is not None
                else "Monitor the nearest structural support."
            ),
            (
                f"Resistance reference: {resistance}"
                if resistance is not None
                else "Monitor the nearest structural resistance."
            ),
            (
                f"ATR reference: {atr}"
                if atr is not None
                else "Reassess volatility with fresh data."
            ),
        ]

    risk_summary = str(ai_risk.get("summary") or "").strip()
    if not risk_summary:
        risk_summary = (
            "Use the technical levels and setup state as invalidation references. "
            "This analysis does not guarantee future outcomes."
        )

    market_summary = str(ai_market.get("summary") or "").strip()
    if not market_summary:
        market_summary = (
            f"The deterministic technical engine currently classifies the market as {bias.lower()}."
        )

    title = str(ai_market.get("title") or "").strip()
    if not title:
        title = "Neutral / mixed" if bias == "NEUTRAL" else f"{bias} technical bias"

    setup_status = str(analysis.get("signal") or ai_setup.get("status") or "WAIT")
    provider = str(
        analysis.get("data_provider")
        or fundamentals.get("provider")
        or "Unknown"
    )

    brief = AgentBrief(
        version="1.0",
        market_view=AgentMarketView(
            bias=bias,
            title=title,
            summary=market_summary,
        ),
        setup_status=AgentSetupStatus(
            status=setup_status,
            technical_evidence_strength=technical_evidence_strength,
            technical_evidence_basis=(
                "Derived only from the deterministic technical directional score; fundamentals are not included."
            ),
        ),
        technical_read=AgentTechnicalRead(
            rsi=_safe_float(analysis.get("rsi")),
            vwap=_safe_float(analysis.get("vwap")),
            ema20=_safe_float(analysis.get("ema20")),
            atr=_safe_float(analysis.get("atr")),
            macd=_safe_float(analysis.get("macd")),
            volume_ratio=_safe_float(analysis.get("volume_ratio")),
            price_vs_vwap_pct=_pct_delta(
                analysis.get("price"),
                analysis.get("vwap"),
            ),
            price_vs_ema20_pct=_pct_delta(
                analysis.get("price"),
                analysis.get("ema20"),
            ),
            ema20_vs_ema50_pct=_pct_delta(
                analysis.get("ema20"),
                analysis.get("ema50"),
            ),
        ),
        fundamental_context=AgentFundamentalContext(
            name=fundamentals.get("name"),
            provider=fundamentals.get("provider"),
            currency=fundamentals.get("currency"),
            trailing_pe=_safe_float(fundamentals.get("trailing_pe")),
            trailing_eps=_safe_float(fundamentals.get("trailing_eps")),
            revenue_growth=_safe_float(fundamentals.get("revenue_growth")),
            market_cap=_safe_float(fundamentals.get("market_cap")),
            dividend_yield=_safe_float(fundamentals.get("dividend_yield")),
        ),
        catalysts=catalysts,
        risk=AgentRisk(
            title=str(ai_risk.get("title") or "Risk / invalidation"),
            summary=risk_summary,
            invalidation=invalidation,
        ),
        context=AgentContext(
            provider=provider,
            timeframe=str(analysis.get("timeframe") or ai_context.get("timeframe") or "—"),
            exchange=str(
                analysis.get("exchange")
                or fundamentals.get("exchange")
                or "—"
            ),
            latest_candle_timestamp=(
                str(analysis.get("latest_candle_timestamp"))
                if analysis.get("latest_candle_timestamp")
                else None
            ),
            market=str(
                analysis.get("market")
                or fundamentals.get("market")
                or "—"
            ),
        ),
    )

    # Explicitly ignore AI-provided numeric technical/fundamental values.
    # This preserves source integrity and keeps the AI in the explanation layer.
    _ = ai_technical
    _ = ai_fundamentals

    return brief


def render_agent_brief(
    brief: AgentBrief,
    analysis: dict[str, Any],
) -> str:
    technical = brief.technical_read
    fundamentals = brief.fundamental_context

    lines = [
        "MARKET VIEW",
        brief.market_view.summary,
        "",
        "SETUP STATUS",
        brief.setup_status.status,
        "",
        "PRICE",
        f"{analysis.get('currency') or ''} {analysis.get('price', 0):,.2f}",
        "",
        "TECHNICAL CONTEXT",
        f"RSI {technical.rsi if technical.rsi is not None else 'Unavailable'} · "
        f"VWAP {technical.vwap if technical.vwap is not None else 'Unavailable'} · "
        f"EMA20 {technical.ema20 if technical.ema20 is not None else 'Unavailable'} · "
        f"ATR {technical.atr if technical.atr is not None else 'Unavailable'}",
        "",
        "FUNDAMENTAL CONTEXT",
        f"P/E {fundamentals.trailing_pe if fundamentals.trailing_pe is not None else 'Unavailable'} · "
        f"EPS {fundamentals.trailing_eps if fundamentals.trailing_eps is not None else 'Unavailable'} · "
        f"Revenue Growth {fundamentals.revenue_growth if fundamentals.revenue_growth is not None else 'Unavailable'}% · "
        f"Market Cap {fundamentals.market_cap if fundamentals.market_cap is not None else 'Unavailable'} · "
        f"Dividend Yield {fundamentals.dividend_yield if fundamentals.dividend_yield is not None else 'Unavailable'}%",
        "",
        "RISK CONSIDERATIONS",
        brief.risk.summary,
        "",
        "WHAT TO MONITOR NEXT",
    ]
    lines.extend(f"• {item}" for item in brief.catalysts)
    return "\n".join(lines)


def generate_ai_explanation(
    command: str,
    analysis: dict[str, Any],
    fundamentals: dict[str, Any] | None = None,
) -> tuple[str, bool, dict[str, Any] | None]:
    api_key = os.getenv("OPENAI_API_KEY")
    if not api_key:
        return (
            "AI explanation is unavailable because OPENAI_API_KEY is not configured.",
            False,
            None,
        )

    model = os.getenv("OPENAI_MODEL", "gpt-5.6-luna")
    fundamentals = fundamentals or {}

    try:
        client = OpenAI(api_key=api_key)

        instructions = """
You are the explanation layer of WOWMAZING Market Agent.

The deterministic market engine has already calculated the numerical market data.
The fundamentals feed has already supplied company data.

Use only supplied information. Do not invent missing values.
Do not create a combined technical + fundamental score.
Do not change or reinterpret source numeric values.
Do not guarantee returns or profits.
Do not present historical strategy results as probabilities for the next trade.
Keep technical evidence, fundamental context, and historical evidence conceptually distinct.

Return ONLY valid JSON. No markdown fences. Use exactly this shape:
{
  "version":"1.0",
  "market_view":{"bias":"BULLISH|BEARISH|NEUTRAL","title":"string","summary":"string"},
  "setup_status":{"status":"string","technical_evidence_strength":null,"technical_evidence_basis":"string"},
  "technical_read":{},
  "fundamental_context":{},
  "catalysts":["string"],
  "risk":{"title":"string","summary":"string","invalidation":["string"]},
  "context":{"provider":"string","timeframe":"string","exchange":"string","latest_candle_timestamp":null,"market":"string"}
}

The server will source-lock the numeric fields from the deterministic engines. Your job is to provide clear narrative wording, catalysts, risk framing, and monitor-next language.
The technical_evidence_strength must be left null; the server computes that value from the deterministic technical directional score only.
"""

        fundamental_context = f"""
Fundamental provider: {fundamentals.get('provider', 'Unavailable')}
Company: {fundamentals.get('name', 'Unavailable')}
Sector: {fundamentals.get('sector', 'Unavailable')}
Industry: {fundamentals.get('industry', 'Unavailable')}
Currency: {fundamentals.get('currency', 'Unavailable')}
Trailing P/E: {fundamentals.get('trailing_pe', 'Unavailable')}
Forward P/E: {fundamentals.get('forward_pe', 'Unavailable')}
Price / Book: {fundamentals.get('price_to_book', 'Unavailable')}
Market Cap: {fundamentals.get('market_cap', 'Unavailable')}
Enterprise Value: {fundamentals.get('enterprise_value', 'Unavailable')}
Trailing EPS: {fundamentals.get('trailing_eps', 'Unavailable')}
Revenue: {fundamentals.get('revenue', 'Unavailable')}
Revenue Growth: {fundamentals.get('revenue_growth', 'Unavailable')}
Profit Margin: {fundamentals.get('profit_margin', 'Unavailable')}
Operating Margin: {fundamentals.get('operating_margin', 'Unavailable')}
Dividend Yield: {fundamentals.get('dividend_yield', 'Unavailable')}
Beta: {fundamentals.get('beta', 'Unavailable')}
Debt / Equity: {fundamentals.get('debt_to_equity', 'Unavailable')}
Return on Equity: {fundamentals.get('return_on_equity', 'Unavailable')}
52 Week Low: {fundamentals.get('fifty_two_week_low', 'Unavailable')}
52 Week High: {fundamentals.get('fifty_two_week_high', 'Unavailable')}
"""

        prompt = f"""
User command:
{command}

TECHNICAL ENGINE RESULT
Symbol: {analysis.get('symbol')}
Timeframe: {analysis.get('timeframe')}
Price: {analysis.get('price')}
Change %: {analysis.get('change_pct')}
Trend: {analysis.get('trend')}
Signal: {analysis.get('signal')}
Bullish score: {analysis.get('bullish_score')}
Bearish score: {analysis.get('bearish_score')}
RSI: {analysis.get('rsi')}
EMA20: {analysis.get('ema20')}
EMA50: {analysis.get('ema50')}
EMA200: {analysis.get('ema200')}
MACD: {analysis.get('macd')}
MACD signal: {analysis.get('macd_signal')}
VWAP: {analysis.get('vwap')}
ATR: {analysis.get('atr')}
Support: {analysis.get('support')}
Resistance: {analysis.get('resistance')}
Volume ratio: {analysis.get('volume_ratio')}
Latest candle timestamp: {analysis.get('latest_candle_timestamp')}
Provider: {analysis.get('data_provider')}
Market: {analysis.get('market')}
Exchange: {analysis.get('exchange')}

REASONS
{analysis.get('reasons')}

FUNDAMENTAL CONTEXT
{fundamental_context}
"""

        response = client.responses.create(
            model=model,
            instructions=instructions,
            input=prompt,
        )

        payload = _extract_json_object(response.output_text)
        return (
            response.output_text,
            True,
            payload,
        )

    except Exception as error:
        print("AI unavailable:", error)
        return (
            "AI explanation is temporarily unavailable. The deterministic market analysis is still available.",
            False,
            None,
        )


# ============================================================
# ROUTES
# ============================================================

@app.get("/health")
def health() -> dict[str, str]:

    return {
        "status": "ok",
        "service": "WOWMAZING Market Agent",
        "version": "0.4.0",
        "market_data_provider": (
            "upstox"
            if MARKET_DATA_PROVIDER != "yfinance"
            else "yfinance"
        ),
    }


@app.get("/instrument/search")
def instrument_search(
    q: str = Query(..., min_length=1, max_length=50),
    market: str = Query("ALL"),
) -> dict[str, Any]:
    """Search NSE/BSE and Yahoo Finance instruments.

    market:
      ALL    -> Upstox India + Yahoo Finance global results
      INDIA  -> Upstox NSE/BSE + Yahoo Finance fallback
      NSE    -> Upstox NSE
      BSE    -> Upstox BSE
      GLOBAL -> Yahoo Finance
    """

    query = q.strip()

    if not query:
        raise HTTPException(
            status_code=400,
            detail="Search query is required.",
        )

    selected_market = market.strip().upper()

    allowed = {
        "ALL",
        "INDIA",
        "NSE",
        "BSE",
        "GLOBAL",
    }

    if selected_market not in allowed:
        raise HTTPException(
            status_code=400,
            detail=(
                "market must be ALL, INDIA, NSE, BSE or GLOBAL."
            ),
        )

    results: list[dict[str, Any]] = []
    seen: set[tuple[str, str, str]] = set()

    def add_result(
        item: dict[str, Any],
    ) -> None:
        key = (
            str(item.get("exchange", "")),
            str(item.get("symbol", "")),
            str(item.get("provider", "")),
        )

        if key in seen:
            return

        seen.add(key)
        results.append(item)

    # --------------------------------------------------------
    # INDIA: PRIMARY UPSTOX SEARCH
    # --------------------------------------------------------

    if (
        selected_market in {
            "ALL",
            "INDIA",
            "NSE",
            "BSE",
        }
        and MARKET_DATA_PROVIDER != "yfinance"
    ):
        try:
            provider = get_upstox_provider()

            exchanges = (
                selected_market
                if selected_market in {"NSE", "BSE"}
                else "NSE,BSE"
            )

            candidates = provider.search_instruments(
                query,
                exchanges=exchanges,
                segments="EQ,INDEX",
                records=30,
            )

            for item in candidates:
                segment = str(
                    item.get("segment", "")
                )
                exchange = str(
                    item.get("exchange", "")
                ).upper()
                trading_symbol = str(
                    item.get(
                        "trading_symbol",
                        "",
                    )
                )
                name = str(
                    item.get(
                        "name",
                        trading_symbol,
                    )
                )

                if not trading_symbol and not name:
                    continue

                if segment.endswith("_EQ"):
                    selection_symbol = (
                        f"{trading_symbol}.BO"
                        if exchange == "BSE"
                        else f"{trading_symbol}.NS"
                    )
                    asset_type = "EQUITY"
                elif segment.endswith("_INDEX"):
                    # Keep the two existing Nifty aliases compatible with
                    # the current frontend. Other indices can still be
                    # opened through their Upstox instrument key in the
                    # future UI upgrade.
                    upper_name = name.upper()

                    if exchange == "NSE" and (
                        "NIFTY 50" in upper_name
                        or trading_symbol.upper() == "NIFTY"
                    ):
                        selection_symbol = "NIFTY 50"
                    elif exchange == "NSE" and (
                        "NIFTY BANK" in upper_name
                        or trading_symbol.upper()
                        in {"BANKNIFTY", "NIFTY BANK"}
                    ):
                        selection_symbol = "BANKNIFTY"
                    else:
                        # Use a provider-qualified value. The market
                        # loader can resolve the instrument key directly.
                        selection_symbol = (
                            item.get(
                                "instrument_key"
                            )
                            or trading_symbol
                        )

                    asset_type = "INDEX"
                else:
                    continue

                add_result(
                    {
                        "symbol": trading_symbol,
                        "name": name,
                        "short_name": item.get(
                            "short_name"
                        ),
                        "exchange": exchange,
                        "country": "India",
                        "currency": "INR",
                        "asset_type": asset_type,
                        "provider": "upstox",
                        "provider_symbol": selection_symbol,
                        "instrument_key": item.get(
                            "instrument_key"
                        ),
                        "segment": segment,
                    }
                )

        except Exception as error:
            # Do not fail the entire global search just because Upstox
            # is unavailable. The response can still contain Yahoo data.
            print(
                "Upstox instrument-search error:",
                error,
            )

    # --------------------------------------------------------
    # GLOBAL / FALLBACK: YFINANCE SEARCH
    # --------------------------------------------------------

    if selected_market in {
        "ALL",
        "INDIA",
        "GLOBAL",
    }:
        try:
            yahoo_results = yf.Search(
                query,
                max_results=12,
                news_count=0,
                lists_count=0,
                include_cb=False,
                include_nav_links=False,
                include_research=False,
                include_cultural_assets=False,
                enable_fuzzy_query=True,
                recommended=12,
            ).quotes

            for quote in yahoo_results:
                quote_type = str(
                    quote.get(
                        "quoteType",
                        "",
                    )
                ).upper()

                if quote_type not in {
                    "EQUITY",
                    "ETF",
                    "INDEX",
                }:
                    continue

                yahoo_symbol = str(
                    quote.get(
                        "symbol",
                        "",
                    )
                ).strip()

                if not yahoo_symbol:
                    continue

                exchange = str(
                    quote.get(
                        "exchDisp",
                        quote.get(
                            "exchange",
                            "",
                        ),
                    )
                ).strip()

                currency = str(
                    quote.get(
                        "currency",
                        "",
                    )
                ).strip()

                if not currency:
                    currency = infer_yfinance_currency(
                        yahoo_symbol,
                        exchange,
                    )

                name = str(
                    quote.get(
                        "longname",
                        quote.get(
                            "shortname",
                            yahoo_symbol,
                        ),
                    )
                )

                # Yahoo exchange labels vary. Keep the raw exchange
                # label so the user can choose the exact listing.
                country = str(
                    quote.get(
                        "country",
                        "",
                    )
                ).strip()

                add_result(
                    {
                        "symbol": yahoo_symbol,
                        "name": name,
                        "short_name": quote.get(
                            "shortname"
                        ),
                        "exchange": exchange or "Yahoo Finance",
                        "country": country,
                        "currency": currency,
                        "asset_type": quote_type,
                        "provider": "yfinance",
                        "provider_symbol": yahoo_symbol,
                        "instrument_key": None,
                        "segment": None,
                    }
                )

        except Exception as error:
            print(
                "yfinance instrument-search error:",
                error,
            )

    # Exact/prefix matches first, then the provider ordering.
    q_upper = query.upper()

    def rank(item: dict[str, Any]) -> tuple[int, int]:
        symbol_upper = str(
            item.get("symbol", "")
        ).upper()
        name_upper = str(
            item.get("name", "")
        ).upper()

        exact_symbol = (
            0
            if symbol_upper == q_upper
            else 1
            if symbol_upper.startswith(q_upper)
            else 2
        )

        exact_name = (
            0
            if name_upper == q_upper
            else 1
            if name_upper.startswith(q_upper)
            else 2
        )

        return (
            min(exact_symbol, exact_name),
            0
            if item.get("provider") == "upstox"
            else 1,
        )

    results.sort(key=rank)

    return {
        "success": True,
        "query": query,
        "market": selected_market,
        "results": results[:20],
    }


@app.get("/market")
def market(
    symbol: str = Query(
        "RELIANCE.NS"
    ),
    timeframe: str = Query(
        "15m"
    ),
    market: str = Query(
        "INDIA"
    ),
) -> dict[str, Any]:

    try:

        data, metadata, quote = (
            download_market_data(
                symbol,
                timeframe,
                market,
            )
        )

        return build_market_analysis(
            data,
            normalize_symbol(
                symbol
            ),
            timeframe,
            metadata,
            quote,
        )

    except Exception as error:

        raise HTTPException(
            status_code=500,
            detail=str(error),
        ) from error


@app.get("/watchlist")
def watchlist_quotes() -> dict[str, Any]:
    """Return current quotes for the dashboard watchlist.

    This endpoint intentionally uses the lightweight quote API rather than
    downloading historical candles for every watchlist symbol.
    """

    symbols = [
        "RELIANCE",
        "TCS",
        "HDFCBANK",
        "INFY",
        "NIFTY 50",
        "BANKNIFTY",
    ]

    # Index instruments must be resolved explicitly. The generic
    # Upstox search can otherwise start with NSE_EQ results for
    # queries such as "Nifty 50", which can return the wrong
    # instrument for a watchlist quote.
    explicit_instrument_keys = {
        "NIFTY 50": "NSE_INDEX|Nifty 50",
        "BANKNIFTY": "NSE_INDEX|Nifty Bank",
    }

    quotes: dict[str, Any] = {}
    errors: dict[str, str] = {}

    if MARKET_DATA_PROVIDER != "yfinance":
        try:
            provider = get_upstox_provider()

            for display_symbol in symbols:
                try:
                    instrument_key = explicit_instrument_keys.get(
                        display_symbol
                    )

                    if not instrument_key:
                        instrument = provider.resolve_instrument(
                            display_symbol
                        )
                        instrument_key = instrument["instrument_key"]

                    quote = provider.get_quote(
                        instrument_key
                    )

                    last_price = float(
                        quote.get("last_price") or 0
                    )

                    # Upstox supplies net_change directly. For index
                    # instruments, prev_close_price can occasionally be
                    # missing or reflect an unexpected reference value.
                    # Prefer net_change and derive the prior close from it.
                    net_change_value = quote.get("net_change")

                    try:
                        net_change = float(net_change_value)
                    except (TypeError, ValueError):
                        net_change = None

                    if net_change is not None:
                        change = net_change
                        previous_close = (
                            last_price - net_change
                        )
                    else:
                        previous_close = float(
                            quote.get("prev_close_price") or 0
                        )
                        change = (
                            last_price - previous_close
                            if previous_close > 0
                            else 0.0
                        )

                    change_pct = (
                        change / previous_close * 100
                        if previous_close > 0
                        else 0.0
                    )

                    quotes[display_symbol] = {
                        "price": last_price,
                        "change": change,
                        "change_pct": change_pct,
                        "net_change": net_change,
                        "provider": "upstox",
                    }

                except Exception as symbol_error:
                    errors[display_symbol] = str(symbol_error)

        except Exception as provider_error:
            errors["_provider"] = str(provider_error)

    return {
        "success": True,
        "quotes": quotes,
        "errors": errors,
        "provider": (
            "upstox"
            if MARKET_DATA_PROVIDER != "yfinance"
            else "yfinance"
        ),
    }


@app.get("/fundamentals")
def fundamentals(
    symbol: str = Query("RELIANCE"),
    market: str = Query("INDIA"),
) -> dict[str, Any]:
    """Return company fundamentals for the selected instrument."""

    try:
        return get_fundamentals(
            symbol,
            market,
        )

    except Exception as error:

        raise HTTPException(
            status_code=500,
            detail=str(error),
        ) from error


@app.get("/strategy/evidence")
def strategy_evidence(
    symbol: str = Query("RELIANCE"),
    timeframe: str = Query("15m"),
    market: str = Query("INDIA"),
) -> dict[str, Any]:
    """
    Run the configured strategy against the selected market history
    and return the full evidence + quantitative analysis payload.

    The result is descriptive research based on historical candles.
    It is not a forecast of the next trade.
    """

    try:
        requested_symbol = normalize_symbol(symbol)

        # Keep exchange-qualified/global symbols exactly as selected.
        # Only strip .NS for Indian strategy analysis because NSE remains
        # the default exchange for ordinary Indian equity symbols.
        strategy_symbol = requested_symbol

        if (
            market.strip().upper() == "INDIA"
            and strategy_symbol.endswith(".NS")
        ):
            strategy_symbol = strategy_symbol[:-3]

        data, metadata, quote = download_market_data(
            strategy_symbol,
            timeframe,
            market,
        )

        result = analyze_strategy(
            data,
            DEFAULT_STRATEGY,
        )

        # Build the compact market snapshot from the exact same
        # candles and quote used by Strategy Evidence. The frontend
        # can therefore render the dashboard header/metrics without
        # making a second market-data request that could drift.
        market_analysis = build_market_analysis(
            data,
            strategy_symbol,
            timeframe,
            metadata,
            quote,
        )

        market_analysis_compact = {
            key: market_analysis.get(key)
            for key in (
                "symbol",
                "timeframe",
                "price",
                "previous_close",
                "change",
                "change_pct",
                "market",
                "currency",
                "exchange",
                "trend",
                "signal",
                "rsi",
                "macd",
                "macd_signal",
                "ema20",
                "ema50",
                "ema200",
                "vwap",
                "atr",
                "support",
                "resistance",
                "volume_ratio",
                "latest_candle_timestamp",
            )
        }

        # Keep provider information alongside the strategy evidence so
        # the frontend can display exactly which data source was used.
        result["market_context"] = {
            "requested_symbol": requested_symbol,
            "resolved_symbol": metadata.get(
                "resolved_symbol"
            ),
            "instrument_key": metadata.get(
                "instrument_key"
            ),
            "segment": metadata.get(
                "segment"
            ),
            "data_provider": metadata.get(
                "provider"
            ),
            "data_note": metadata.get(
                "note"
            ),
            "market": metadata.get(
                "market"
            ),
            "currency": metadata.get(
                "currency"
            ),
            "exchange": metadata.get(
                "exchange"
            ),
            "timeframe": timeframe,
            "latest_candle": (
                str(data.index[-1])
                if len(data)
                else None
            ),
            "quote": quote or {},
            "analysis": market_analysis_compact,
        }

        return result

    except HTTPException:
        raise

    except Exception as error:
        raise HTTPException(
            status_code=500,
            detail=str(error),
        ) from error


@app.post(
    "/agent",
    response_model=AgentResponse,
)
def agent(
    request: AgentRequest,
) -> AgentResponse:

    try:

        data, metadata, quote = (
            download_market_data(
                request.symbol,
                request.timeframe,
                request.market,
            )
        )

        analysis = build_market_analysis(
            data,
            normalize_symbol(
                request.symbol
            ),
            request.timeframe,
            metadata,
            quote,
        )

        # Fundamentals are additional research context.
        # Failure here must not break the technical agent.
        try:

            fundamentals = get_fundamentals(
                request.symbol,
                request.market,
            )

        except Exception as fundamentals_error:

            print(
                "Fundamentals unavailable for agent:",
                fundamentals_error,
            )

            fundamentals = {
                "success": False,
                "supported": False,
                "message": (
                    "Fundamentals could not be loaded."
                ),
            }

        ai_answer, ai_used, ai_payload = (
            generate_ai_explanation(
                request.command,
                analysis,
                fundamentals,
            )
        )

        brief = build_agent_brief(
            analysis,
            fundamentals,
            ai_payload,
        )

        fallback = (
            f"""
MARKET VIEW
{analysis["trend"]}

SETUP STATUS
{analysis["signal"]}

PRICE
{analysis.get("currency") or ""} {analysis["price"]:,.2f}

CHANGE
{analysis["change_pct"]:+.2f}%

DATA PROVIDER
{analysis["data_provider"]}

BULLISH SCORE
{analysis["bullish_score"]}/10

BEARISH SCORE
{analysis["bearish_score"]}/10

TECHNICAL EVIDENCE
"""
            + "\n".join(
                f"• {reason}"
                for reason in analysis[
                    "reasons"
                ]
            )
            + f"""

FUNDAMENTAL CONTEXT

COMPANY
{fundamentals.get("name", "Unavailable")}

TTM P/E
{fundamentals.get("trailing_pe", "Unavailable")}

FORWARD P/E
{fundamentals.get("forward_pe", "Unavailable")}

EPS (TTM)
{fundamentals.get("trailing_eps", "Unavailable")}

REVENUE GROWTH
{fundamentals.get("revenue_growth", "Unavailable")}

PROFIT MARGIN
{fundamentals.get("profit_margin", "Unavailable")}

DIVIDEND YIELD
{fundamentals.get("dividend_yield", "Unavailable")}

DEBT / EQUITY
{fundamentals.get("debt_to_equity", "Unavailable")}

FUNDAMENTAL DATA PROVIDER
{fundamentals.get("provider", "Unavailable")}

RISK NOTE
This is research based on the supplied
market and company data. It does not
guarantee future returns or profits.
"""
        )

        final_answer = (
            render_agent_brief(brief, analysis)
            if ai_used
            else fallback
        )

        return AgentResponse(
            success=True,
            answer=final_answer,
            market_snapshot=analysis,
            fundamentals=fundamentals,
            brief=brief,
            ai_used=ai_used,
            error=None,
        )

    except Exception as error:

        return AgentResponse(
            success=False,
            answer="",
            market_snapshot={},
            fundamentals=None,
            brief=None,
            ai_used=False,
            error=str(error),
        )

