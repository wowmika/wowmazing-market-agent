import os
import sys

from dotenv import load_dotenv

from providers.upstox import (
    UpstoxProvider,
)


load_dotenv("backend/.env")

token = os.getenv(
    "UPSTOX_ANALYTICS_TOKEN"
)

if not token:

    print(
        "ERROR: UPSTOX_ANALYTICS_TOKEN "
        "not found."
    )

    sys.exit(1)


provider = UpstoxProvider(token)


print("=" * 60)
print(
    "WOWMAZING - UPSTOX PROVIDER TEST"
)
print("=" * 60)
print()


# ---------------------------------------------------------
# Resolve RELIANCE
# ---------------------------------------------------------

instrument = provider.resolve_instrument(
    "RELIANCE"
)


print("Resolved instrument:")
print(
    "Name          :",
    instrument.get("name")
)

print(
    "Trading symbol:",
    instrument.get("trading_symbol")
)

print(
    "Segment       :",
    instrument.get("segment")
)

print(
    "Instrument key:",
    instrument.get("instrument_key")
)

print()


# ---------------------------------------------------------
# Quote
# ---------------------------------------------------------

quote = provider.get_quote(
    instrument["instrument_key"]
)

print("----- QUOTE -----")

print(
    "Symbol:",
    quote.get("symbol")
)

print(
    "Last price:",
    quote.get("last_price")
)

print()


# ---------------------------------------------------------
# Candles
# ---------------------------------------------------------

candles = provider.get_candles(
    instrument["instrument_key"],
    "15m",
)

print("----- CANDLES -----")

print(
    "Candle count:",
    len(candles)
)

print(
    "Latest candle:",
    candles[0]
)

print()

print("=" * 60)
print(
    "UPSTOX PROVIDER TEST PASSED"
)
print("=" * 60)