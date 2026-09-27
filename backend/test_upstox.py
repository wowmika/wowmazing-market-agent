import os
import sys

import requests
from dotenv import load_dotenv


load_dotenv("backend/.env")

token = os.getenv("UPSTOX_ANALYTICS_TOKEN")

if not token:
    print("ERROR: UPSTOX_ANALYTICS_TOKEN not found.")
    sys.exit(1)


# Reliance Industries Ltd — NSE
instrument_key = "NSE_EQ|INE002A01018"

url = "https://api.upstox.com/v3/market-quote/quotes"

headers = {
    "Accept": "application/json",
    "Authorization": f"Bearer {token}",
}

params = {
    "instrument_key": instrument_key,
}


print("=" * 60)
print("WOWMAZING MARKET AGENT - UPSTOX TEST")
print("=" * 60)
print()
print("Symbol     : RELIANCE")
print("Instrument : NSE_EQ|INE002A01018")
print("Provider   : Upstox")
print()

try:
    response = requests.get(
        url,
        headers=headers,
        params=params,
        timeout=15,
    )
except requests.RequestException as exc:
    print("CONNECTION ERROR:")
    print(exc)
    sys.exit(1)


print("HTTP Status:", response.status_code)
print()

if response.status_code != 200:
    print("UPSTOX REQUEST FAILED")
    print(response.text)
    sys.exit(1)


try:
    payload = response.json()
except ValueError:
    print("ERROR: Upstox returned invalid JSON.")
    print(response.text)
    sys.exit(1)


data = payload.get("data", {})

if not data:
    print("ERROR: No market data returned.")
    print(payload)
    sys.exit(1)


quote = next(iter(data.values()))

print("CONNECTION SUCCESSFUL")
print()
print("----- MARKET SNAPSHOT -----")
print("Symbol       :", quote.get("symbol"))
print("Last Price   :", quote.get("last_price"))

ohlc = quote.get("ohlc", {})

print("Open         :", ohlc.get("open"))
print("High         :", ohlc.get("high"))
print("Low          :", ohlc.get("low"))
print("Close        :", ohlc.get("close"))
print("Volume       :", ohlc.get("volume"))
print()

print("=" * 60)
print("UPSTOX MARKET DATA TEST PASSED")
print("=" * 60)