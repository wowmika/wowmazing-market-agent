import os
import sys
from datetime import datetime, timedelta

import requests
from dotenv import load_dotenv


# ---------------------------------------------------------
# Load token
# ---------------------------------------------------------

load_dotenv("backend/.env")

token = os.getenv("UPSTOX_ANALYTICS_TOKEN")

if not token:
    print("ERROR: UPSTOX_ANALYTICS_TOKEN not found.")
    sys.exit(1)


# ---------------------------------------------------------
# Instrument
# ---------------------------------------------------------

instrument_key = "NSE_EQ|INE002A01018"

# 15-minute candles
unit = "minutes"
interval = "15"


# ---------------------------------------------------------
# Dates
# ---------------------------------------------------------

today = datetime.now().date()

# Get roughly the previous 7 calendar days.
# The API will return the trading-day candles available
# in that range.

to_date = today.strftime("%Y-%m-%d")
from_date = (today - timedelta(days=7)).strftime("%Y-%m-%d")


# ---------------------------------------------------------
# Upstox Historical Candle V3
# ---------------------------------------------------------

url = (
    f"https://api.upstox.com/v3/historical-candle/"
    f"{instrument_key}/{unit}/{interval}/{to_date}/{from_date}"
)

headers = {
    "Accept": "application/json",
    "Authorization": f"Bearer {token}",
}


print("=" * 60)
print("WOWMAZING MARKET AGENT - UPSTOX CANDLE TEST")
print("=" * 60)
print()
print("Symbol     : RELIANCE")
print("Instrument : NSE_EQ|INE002A01018")
print("Timeframe  : 15 minutes")
print("From       :", from_date)
print("To         :", to_date)
print()


# ---------------------------------------------------------
# Request
# ---------------------------------------------------------

try:
    response = requests.get(
        url,
        headers=headers,
        timeout=20,
    )
except requests.RequestException as exc:
    print("CONNECTION ERROR:")
    print(exc)
    sys.exit(1)


print("HTTP Status:", response.status_code)
print()


# ---------------------------------------------------------
# Error handling
# ---------------------------------------------------------

if response.status_code != 200:
    print("UPSTOX CANDLE REQUEST FAILED")
    print(response.text)
    sys.exit(1)


try:
    payload = response.json()
except ValueError:
    print("ERROR: Invalid JSON returned by Upstox.")
    print(response.text)
    sys.exit(1)


# ---------------------------------------------------------
# Extract candles
# ---------------------------------------------------------

data = payload.get("data", {})
candles = data.get("candles", [])


if not candles:
    print("ERROR: No candles returned.")
    print(payload)
    sys.exit(1)


print("Candle count:", len(candles))
print()


# ---------------------------------------------------------
# Display newest 10 candles
# ---------------------------------------------------------

print("----- LAST 10 CANDLES -----")
print()

for candle in candles[:10]:
    timestamp = candle[0]
    open_price = candle[1]
    high_price = candle[2]
    low_price = candle[3]
    close_price = candle[4]
    volume = candle[5]

    print(
        f"{timestamp} | "
        f"O {open_price:<10} "
        f"H {high_price:<10} "
        f"L {low_price:<10} "
        f"C {close_price:<10} "
        f"V {volume}"
    )


print()
print("=" * 60)
print("UPSTOX CANDLE TEST PASSED")
print("=" * 60)