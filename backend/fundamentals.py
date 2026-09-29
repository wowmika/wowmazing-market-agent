from __future__ import annotations

import math
import time
from datetime import datetime, timezone
from typing import Any

import yfinance as yf


_CACHE_TTL_SECONDS = 600.0
_CACHE: dict[str, tuple[float, dict[str, Any]]] = {}


def _number(value: Any) -> float | None:
    """Return a finite float or None for Yahoo/yfinance values."""
    try:
        if value is None:
            return None

        number = float(value)

        if not math.isfinite(number):
            return None

        return number

    except (TypeError, ValueError):
        return None


def _percentage(value: Any) -> float | None:
    """Normalize decimal ratios such as 0.12 to 12.0 percent."""
    number = _number(value)

    if number is None:
        return None

    if -1.0 <= number <= 1.0:
        return number * 100.0

    return number


def _fast_value(
    fast_info: Any,
    name: str,
) -> Any:

    try:
        return getattr(
            fast_info,
            name,
        )

    except Exception:
        return None


def _symbol_candidates(
    symbol: str,
    market: str,
) -> list[str]:

    normalized = symbol.strip().upper()
    selected_market = market.strip().upper()

    if selected_market == "INDEX":
        return []

    if selected_market == "GLOBAL":
        return [normalized]

    if (
        normalized.endswith(".BO")
        or normalized.endswith(".NS")
    ):
        return [normalized]

    if normalized.startswith("^"):
        return [normalized]

    return [
        f"{normalized}.NS",
        normalized,
    ]


def _load_from_yahoo(
    symbol: str,
    market: str,
) -> dict[str, Any]:

    candidates = _symbol_candidates(
        symbol,
        market,
    )

    if not candidates:

        return {
            "success": True,
            "supported": False,
            "message": (
                "Fundamental company metrics are "
                "not applicable to market indexes."
            ),
            "provider": "yfinance",
            "symbol": symbol,
            "market": market,
            "retrieved_at": (
                datetime.now(
                    timezone.utc
                ).isoformat()
            ),
        }

    last_error: Exception | None = None

    for resolved_symbol in candidates:

        try:

            ticker = yf.Ticker(
                resolved_symbol
            )

            info = ticker.info or {}
            fast_info = ticker.fast_info

            name = (
                info.get("longName")
                or info.get("shortName")
                or info.get("displayName")
                or resolved_symbol
            )

            market_cap = _number(
                info.get("marketCap")
            )

            if market_cap is None:

                market_cap = _number(
                    _fast_value(
                        fast_info,
                        "market_cap",
                    )
                )

            year_low = _number(
                info.get(
                    "fiftyTwoWeekLow"
                )
            )

            if year_low is None:

                year_low = _number(
                    _fast_value(
                        fast_info,
                        "year_low",
                    )
                )

            year_high = _number(
                info.get(
                    "fiftyTwoWeekHigh"
                )
            )

            if year_high is None:

                year_high = _number(
                    _fast_value(
                        fast_info,
                        "year_high",
                    )
                )

            currency = (
                str(
                    info.get(
                        "currency"
                    )
                    or ""
                )
                .strip()
                .upper()
            )

            if not currency:

                currency = (
                    str(
                        _fast_value(
                            fast_info,
                            "currency",
                        )
                        or ""
                    )
                    .strip()
                    .upper()
                )

            exchange = str(
                info.get(
                    "exchange"
                )
                or _fast_value(
                    fast_info,
                    "exchange",
                )
                or ""
            ).strip()

            result = {

                "success": True,

                "supported": True,

                "provider": "yfinance",

                "symbol": symbol,

                "resolved_symbol": (
                    resolved_symbol
                ),

                "market": (
                    market
                    .strip()
                    .upper()
                ),

                "retrieved_at": (
                    datetime.now(
                        timezone.utc
                    ).isoformat()
                ),

                "name": str(
                    name
                ),

                "sector": info.get(
                    "sector"
                ),

                "industry": info.get(
                    "industry"
                ),

                "currency": currency,

                "exchange": exchange,

                "trailing_pe": _number(
                    info.get(
                        "trailingPE"
                    )
                ),

                "forward_pe": _number(
                    info.get(
                        "forwardPE"
                    )
                ),

                "price_to_book": _number(
                    info.get(
                        "priceToBook"
                    )
                ),

                "market_cap": market_cap,

                "enterprise_value": _number(
                    info.get(
                        "enterpriseValue"
                    )
                ),

                "trailing_eps": _number(
                    info.get(
                        "trailingEps"
                    )
                ),

                "revenue": _number(
                    info.get(
                        "totalRevenue"
                    )
                ),

                "revenue_growth": _percentage(
                    info.get(
                        "revenueGrowth"
                    )
                ),

                "profit_margin": _percentage(
                    info.get(
                        "profitMargins"
                    )
                ),

                "operating_margin": _percentage(
                    info.get(
                        "operatingMargins"
                    )
                ),

                "dividend_yield": _number(
                    info.get(
                        "dividendYield"
                    )
                ),

                "beta": _number(
                    info.get(
                        "beta"
                    )
                ),

                "debt_to_equity": _number(
                    info.get(
                        "debtToEquity"
                    )
                ),

                "return_on_equity": _percentage(
                    info.get(
                        "returnOnEquity"
                    )
                ),

                "fifty_two_week_low": (
                    year_low
                ),

                "fifty_two_week_high": (
                    year_high
                ),
            }

            useful_fields = (

                result[
                    "market_cap"
                ],

                result[
                    "trailing_pe"
                ],

                result[
                    "trailing_eps"
                ],

                result[
                    "fifty_two_week_low"
                ],

                result[
                    "fifty_two_week_high"
                ],

                result[
                    "revenue"
                ],
            )

            if any(
                value is not None
                for value in useful_fields
            ):

                return result

        except Exception as error:

            last_error = error

    detail = (
        str(last_error)
        if last_error
        else
        "No usable Yahoo Finance result."
    )

    raise ValueError(
        f"Fundamentals unavailable "
        f"for '{symbol}'. "
        f"Tried: {', '.join(candidates)}. "
        f"Details: {detail}"
    )


def get_fundamentals(
    symbol: str,
    market: str = "INDIA",
) -> dict[str, Any]:

    """Return cached company fundamentals."""

    normalized_symbol = (
        symbol.strip().upper()
    )

    normalized_market = (
        market.strip().upper()
    )

    cache_key = (
        f"{normalized_market}:"
        f"{normalized_symbol}"
    )

    now = time.time()

    cached = _CACHE.get(
        cache_key
    )

    if (
        cached
        and now - cached[0]
        < _CACHE_TTL_SECONDS
    ):

        return dict(
            cached[1]
        )

    result = _load_from_yahoo(
        normalized_symbol,
        normalized_market,
    )

    _CACHE[
        cache_key
    ] = (
        now,
        result,
    )

    if len(_CACHE) > 128:

        oldest_key = min(
            _CACHE,
            key=lambda key:
                _CACHE[key][0],
        )

        _CACHE.pop(
            oldest_key,
            None,
        )

    return dict(
        result
    )