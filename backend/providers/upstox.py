from __future__ import annotations

import re
from datetime import date, datetime, timedelta
from typing import Any
from urllib.parse import quote

import requests


SUPPORTED_TIMEFRAMES = {
    "1m",
    "3m",
    "5m",
    "15m",
    "30m",
    "1H",
    "4H",
    "1D",
    "1W",
}


TIMEFRAME_CONFIG = {
    "1m": ("minutes", "1"),
    "3m": ("minutes", "3"),
    "5m": ("minutes", "5"),
    "15m": ("minutes", "15"),
    "30m": ("minutes", "30"),
    "1H": ("hours", "1"),
    "4H": ("hours", "4"),
    "1D": ("days", "1"),
    "1W": ("weeks", "1"),
}


# Approximate amount of history we want available to the
# indicator engine.
#
# We deliberately collect enough data for EMA200 and the
# other indicators instead of relying only on today's candles.
LOOKBACK_DAYS = {
    "1m": 15,
    "3m": 20,
    "5m": 30,
    "15m": 30,
    "30m": 120,
    "1H": 180,
    "4H": 365,
    "1D": 730,
    "1W": 3650,
}


class UpstoxProviderError(RuntimeError):
    """Raised when the Upstox market-data provider fails."""


class UpstoxProvider:
    BASE_URL = "https://api.upstox.com"

    def __init__(
        self,
        access_token: str,
        timeout: int = 20,
    ) -> None:

        if not access_token:
            raise UpstoxProviderError(
                "UPSTOX_ANALYTICS_TOKEN is missing."
            )

        self.access_token = access_token
        self.timeout = timeout

        self.session = requests.Session()

        self.session.headers.update(
            {
                "Accept": "application/json",
                "Authorization": (
                    f"Bearer {self.access_token}"
                ),
            }
        )

    # ========================================================
    # HTTP
    # ========================================================

    def _get(
        self,
        url: str,
        params: dict[str, Any] | None = None,
    ) -> dict[str, Any]:

        try:
            response = self.session.get(
                url,
                params=params,
                timeout=self.timeout,
            )

        except requests.RequestException as exc:

            raise UpstoxProviderError(
                f"Network error while contacting Upstox: {exc}"
            ) from exc

        if response.status_code != 200:

            try:
                detail = response.json()

            except ValueError:

                detail = response.text

            raise UpstoxProviderError(
                f"Upstox HTTP {response.status_code}: {detail}"
            )

        try:
            return response.json()

        except ValueError as exc:

            raise UpstoxProviderError(
                "Upstox returned invalid JSON."
            ) from exc

    # ========================================================
    # SYMBOL HELPERS
    # ========================================================

    @staticmethod
    def _clean_query(symbol: str) -> str:

        value = symbol.strip().upper()

        value = re.sub(
            r"\.NS$",
            "",
            value,
        )

        value = re.sub(
            r"\.BO$",
            "",
            value,
        )

        aliases = {
            "NIFTY": "Nifty 50",
            "NIFTY50": "Nifty 50",
            "NIFTY 50": "Nifty 50",

            "BANKNIFTY": "Nifty Bank",
            "BANK NIFTY": "Nifty Bank",
            "NIFTY BANK": "Nifty Bank",
        }

        return aliases.get(
            value,
            value,
        )

    # ========================================================
    # INSTRUMENT SEARCH
    # ========================================================

    def search_instruments(
        self,
        query: str,
        exchanges: str = "NSE,BSE",
        segments: str = "EQ,INDEX",
        records: int = 30,
    ) -> list[dict[str, Any]]:
        """Search Upstox instruments by symbol/name.

        Upstox supports free-text search with exchange and segment
        filters. We keep the provider method generic so the UI can
        search NSE/BSE equities and indices without hard-coded symbols.
        """

        clean_query = self._clean_query(query)

        if not clean_query:
            return []

        payload = self._get(
            f"{self.BASE_URL}/v2/instruments/search",
            params={
                "query": clean_query,
                "exchanges": exchanges,
                "segments": segments,
                "page_number": 1,
                "records": min(max(records, 1), 30),
            },
        )

        return payload.get("data") or []

    def resolve_instrument(
        self,
        symbol: str,
    ) -> dict[str, Any]:

        # Allow an already-resolved Upstox instrument key.
        if "|" in symbol:
            return {
                "instrument_key": symbol.strip(),
                "trading_symbol": symbol.strip(),
                "name": symbol.strip(),
                "segment": symbol.split(
                    "|",
                    1,
                )[0],
            }

        raw_symbol = symbol.strip().upper()

        # Explicit exchange suffixes remove ambiguity.
        exchange_hint: str | None = None

        if raw_symbol.endswith(".BO"):
            exchange_hint = "BSE"
        elif raw_symbol.endswith(".NS"):
            exchange_hint = "NSE"

        query = self._clean_query(raw_symbol)

        candidates = self.search_instruments(
            query,
            exchanges=exchange_hint or "NSE",
            segments="EQ,INDEX",
            records=30,
        )

        if not candidates:
            raise UpstoxProviderError(
                f"Could not resolve '{symbol}' "
                "to a supported Upstox instrument."
            )

        query_upper = query.upper()

        # Prefer an exact equity symbol match.
        exact_equity = [
            item
            for item in candidates
            if (
                str(
                    item.get(
                        "trading_symbol",
                        "",
                    )
                ).upper()
                == query_upper
            )
            and str(
                item.get(
                    "segment",
                    "",
                )
            ).endswith("_EQ")
        ]

        if exact_equity:
            return exact_equity[0]

        # Then prefer an exact index name/symbol match.
        exact_index = [
            item
            for item in candidates
            if (
                str(
                    item.get(
                        "name",
                        "",
                    )
                ).upper()
                == query_upper
            )
            or (
                str(
                    item.get(
                        "trading_symbol",
                        "",
                    )
                ).upper()
                == query_upper
            )
        ]

        if exact_index:
            return exact_index[0]

        # Finally return the first filtered instrument.
        return candidates[0]

    # ========================================================
    # CURRENT QUOTE
    # ========================================================

    def get_quote(
        self,
        instrument_key: str,
    ) -> dict[str, Any]:

        payload = self._get(
            f"{self.BASE_URL}/v3/market-quote/quotes",
            params={
                "instrument_key": instrument_key,
            },
        )

        data = payload.get("data") or {}

        if not data:

            raise UpstoxProviderError(
                f"No quote returned for {instrument_key}."
            )

        return next(iter(data.values()))

    # ========================================================
    # INTRADAY CANDLES
    # ========================================================

    def get_intraday_candles(
        self,
        instrument_key: str,
        timeframe: str,
    ) -> list[list[Any]]:

        if timeframe not in SUPPORTED_TIMEFRAMES:

            raise UpstoxProviderError(
                f"Unsupported timeframe: {timeframe}"
            )

        unit, interval = TIMEFRAME_CONFIG[timeframe]

        encoded_key = quote(
            instrument_key,
            safe="",
        )

        url = (
            f"{self.BASE_URL}/v3/"
            f"historical-candle/intraday/"
            f"{encoded_key}/"
            f"{unit}/"
            f"{interval}"
        )

        payload = self._get(url)

        return (
            (payload.get("data") or {})
            .get("candles")
            or []
        )

    # ========================================================
    # HISTORICAL CANDLES FOR A DATE RANGE
    # ========================================================

    def get_historical_range(
        self,
        instrument_key: str,
        timeframe: str,
        from_date: date,
        to_date: date,
    ) -> list[list[Any]]:

        if timeframe not in SUPPORTED_TIMEFRAMES:

            raise UpstoxProviderError(
                f"Unsupported timeframe: {timeframe}"
            )

        if from_date > to_date:

            return []

        unit, interval = TIMEFRAME_CONFIG[timeframe]

        encoded_key = quote(
            instrument_key,
            safe="",
        )

        url = (
            f"{self.BASE_URL}/v3/"
            f"historical-candle/"
            f"{encoded_key}/"
            f"{unit}/"
            f"{interval}/"
            f"{to_date.isoformat()}/"
            f"{from_date.isoformat()}"
        )

        payload = self._get(url)

        return (
            (payload.get("data") or {})
            .get("candles")
            or []
        )

    # ========================================================
    # HISTORICAL CHUNK SIZE
    # ========================================================

    @staticmethod
    def _max_historical_chunk_days(
        timeframe: str,
    ) -> int:

        if timeframe in {
            "1m",
            "3m",
            "5m",
            "15m",
        }:
            # Upstox V3 minute intervals up to 15m
            # are retrieved in approximately one-month
            # windows.
            return 28

        if timeframe in {
            "30m",
            "1H",
            "4H",
        }:
            # Keep chunks safely inside the quarter-sized
            # historical window.
            return 85

        return 3650

    # ========================================================
    # COMBINED CANDLE DOWNLOAD
    # ========================================================

    def get_candles(
        self,
        instrument_key: str,
        timeframe: str,
    ) -> list[list[Any]]:

        if timeframe not in SUPPORTED_TIMEFRAMES:

            raise UpstoxProviderError(
                f"Unsupported timeframe: {timeframe}"
            )

        today = date.today()

        lookback_days = LOOKBACK_DAYS[timeframe]

        start_date = (
            today
            - timedelta(
                days=lookback_days
            )
        )

        # ----------------------------------------------------
        # Historical data
        #
        # We download up to yesterday so that today's data
        # can be obtained from the dedicated intraday API.
        # ----------------------------------------------------

        historical_end = (
            today - timedelta(days=1)
        )

        all_candles: list[list[Any]] = []

        if start_date <= historical_end:

            max_chunk_days = (
                self._max_historical_chunk_days(
                    timeframe
                )
            )

            chunk_start = start_date

            while chunk_start <= historical_end:

                chunk_end = min(
                    chunk_start
                    + timedelta(
                        days=max_chunk_days - 1
                    ),
                    historical_end,
                )

                candles = (
                    self.get_historical_range(
                        instrument_key,
                        timeframe,
                        chunk_start,
                        chunk_end,
                    )
                )

                all_candles.extend(candles)

                chunk_start = (
                    chunk_end
                    + timedelta(days=1)
                )

        # ----------------------------------------------------
        # Current day
        #
        # V3 Intraday Candle Data provides current-day
        # candles. We append these to the historical series.
        # ----------------------------------------------------

        if timeframe != "1W":

            try:

                intraday = (
                    self.get_intraday_candles(
                        instrument_key,
                        timeframe,
                    )
                )

                all_candles.extend(
                    intraday
                )

            except UpstoxProviderError:

                # Historical data is still useful when the
                # market is closed or no current-day candle
                # exists.
                pass

        if not all_candles:

            raise UpstoxProviderError(
                "Upstox returned no candles."
            )

        # ----------------------------------------------------
        # De-duplicate by candle timestamp.
        # ----------------------------------------------------

        unique: dict[str, list[Any]] = {}

        for candle in all_candles:

            if not candle:
                continue

            timestamp_key = str(
                candle[0]
            )

            unique[timestamp_key] = candle

        candles = list(
            unique.values()
        )

        # API responses commonly arrive newest-first.
        # The indicator engine needs chronological order.
        candles.sort(
            key=lambda item: str(
                item[0]
            )
        )

        return candles