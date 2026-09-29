import { API_BASE_URL } from "../config";
import { useEffect, useRef, useState } from "react";
import {
  CandlestickSeries,
  ColorType,
  createChart,
  LineSeries,
  type UTCTimestamp,
} from "lightweight-charts";

type TradingChartProps = {
  symbol: string;
  timeframe: string;
  market: "INDIA" | "GLOBAL" | "INDEX";
  showEMA20: boolean;
  showEMA50: boolean;
  showVWAP: boolean;
};

type Candle = {
  time: UTCTimestamp;
  open: number;
  high: number;
  low: number;
  close: number;
};

type LinePoint = {
  time: UTCTimestamp;
  value: number;
};

type MarketResponse = {
  symbol: string;
  timeframe: string;
  price: number;
  trend: string;
  signal: string;

  candles: {
    time: number;
    open: number;
    high: number;
    low: number;
    close: number;
    volume: number;
  }[];

  series: {
    ema20: {
      time: number;
      value: number;
    }[];

    ema50: {
      time: number;
      value: number;
    }[];

    vwap: {
      time: number;
      value: number;
    }[];
  };

  support: number;
  resistance: number;
};


// ============================================================
// SYMBOL NORMALIZATION
// ============================================================

function normalizeSymbol(
  symbol: string,
  market: "INDIA" | "GLOBAL" | "INDEX",
): string {
  const cleaned =
    symbol.trim().toUpperCase();

  // Global instruments must stay as their exact Yahoo Finance symbol.
  // Example: AAPL must remain AAPL, not AAPL.NS.
  if (market === "GLOBAL") {
    return cleaned;
  }

  if (
    cleaned === "NIFTY 50" ||
    cleaned === "NIFTY"
  ) {
    return "^NSEI";
  }

  if (
    cleaned === "BANKNIFTY" ||
    cleaned === "BANK NIFTY" ||
    cleaned === "NIFTY BANK"
  ) {
    return "^NSEBANK";
  }

  if (
    cleaned.startsWith("^") ||
    cleaned.endsWith(".NS") ||
    cleaned.endsWith(".BO")
  ) {
    return cleaned;
  }

  return `${cleaned}.NS`;
}


// ============================================================
// CONVERT API SERIES TO LIGHTWEIGHT-CHARTS SERIES
// ============================================================

function toLineData(
  data: {
    time: number;
    value: number;
  }[],
): LinePoint[] {
  return data.map(
    (item) => ({
      time:
        item.time as UTCTimestamp,
      value: item.value,
    }),
  );
}


// ============================================================
// TRADING CHART
// ============================================================

export default function TradingChart({
  symbol,
  timeframe,
  market,
  showEMA20,
  showEMA50,
  showVWAP,
}: TradingChartProps) {

  const containerRef =
    useRef<HTMLDivElement | null>(
      null,
    );

  const [loading, setLoading] =
    useState(true);

  const [error, setError] =
    useState("");

  const [marketData, setMarketData] =
    useState<MarketResponse | null>(
      null,
    );


  // ==========================================================
  // FETCH MARKET DATA
  // ==========================================================

  useEffect(() => {

    let cancelled = false;

    async function loadMarketData() {

      setLoading(true);
      setError("");

      try {

        const apiSymbol =
          normalizeSymbol(
            symbol,
            market,
          );

        const url =
          `${API_BASE_URL}/market` +
          `?symbol=${encodeURIComponent(apiSymbol)}` +
          `&timeframe=${encodeURIComponent(timeframe)}` +
          `&market=${encodeURIComponent(market)}`;

        const response =
          await fetch(url);

        if (!response.ok) {

          throw new Error(
            `Market API returned HTTP ${response.status}.`,
          );
        }

        const data =
          (await response.json()) as MarketResponse;

        if (
          !data.candles ||
          !data.candles.length
        ) {

          throw new Error(
            "The market API returned no candle data.",
          );
        }

        if (!cancelled) {

          setMarketData(data);
        }

      } catch (err) {

        if (cancelled) {
          return;
        }

        const message =
          err instanceof Error
            ? err.message
            : "Unknown market data error.";

        setError(message);
        setMarketData(null);

      } finally {

        if (!cancelled) {

          setLoading(false);
        }
      }
    }

    loadMarketData();

    return () => {
      cancelled = true;
    };

  }, [
    symbol,
    timeframe,
    market,
  ]);


  // ==========================================================
  // CREATE / UPDATE CHART
  // ==========================================================

  useEffect(() => {

    if (
      !containerRef.current ||
      !marketData ||
      !marketData.candles?.length
    ) {
      return;
    }

    const container =
      containerRef.current;

    // --------------------------------------------------------
    // Chart
    // --------------------------------------------------------

    const chart = createChart(
      container,
      {
        autoSize: true,

        layout: {
          background: {
            type: ColorType.Solid,
            color: "#09111f",
          },

          textColor: "#72849d",

          fontSize: 11,
        },

        grid: {
          vertLines: {
            color: "#17243a",
          },

          horzLines: {
            color: "#17243a",
          },
        },

        crosshair: {
          vertLine: {
            color: "#405675",
            width: 1,
            style: 2,
            labelBackgroundColor:
              "#17263c",
          },

          horzLine: {
            color: "#405675",
            width: 1,
            style: 2,
            labelBackgroundColor:
              "#17263c",
          },
        },

        rightPriceScale: {
          borderColor:
            "#1d2b42",

          scaleMargins: {
            top: 0.08,
            bottom: 0.08,
          },
        },

        timeScale: {
          borderColor:
            "#1d2b42",

          timeVisible: true,

          secondsVisible: false,
        },
      },
    );


    // ========================================================
    // CANDLES
    // ========================================================

    const candleSeries =
      chart.addSeries(
        CandlestickSeries,
        {
          upColor:
            "#22c55e",

          downColor:
            "#ef4444",

          borderVisible:
            false,

          wickUpColor:
            "#22c55e",

          wickDownColor:
            "#ef4444",
        },
      );


    const candles: Candle[] =
      marketData.candles.map(
        (item) => ({
          time:
            item.time as UTCTimestamp,

          open: item.open,

          high: item.high,

          low: item.low,

          close: item.close,
        }),
      );


    candleSeries.setData(
      candles,
    );


    // ========================================================
    // EMA 20
    // ========================================================

    if (
      showEMA20 &&
      marketData.series.ema20.length
    ) {

      const ema20 =
        chart.addSeries(
          LineSeries,
          {
            color:
              "#8b5cf6",

            lineWidth: 2,

            title:
              "EMA 20",
          },
        );

      ema20.setData(
        toLineData(
          marketData.series.ema20,
        ),
      );
    }


    // ========================================================
    // EMA 50
    // ========================================================

    if (
      showEMA50 &&
      marketData.series.ema50.length
    ) {

      const ema50 =
        chart.addSeries(
          LineSeries,
          {
            color:
              "#f59e0b",

            lineWidth: 2,

            title:
              "EMA 50",
          },
        );

      ema50.setData(
        toLineData(
          marketData.series.ema50,
        ),
      );
    }


    // ========================================================
    // VWAP
    // ========================================================

    if (
      showVWAP &&
      marketData.series.vwap.length
    ) {

      const vwap =
        chart.addSeries(
          LineSeries,
          {
            color:
              "#00e5ff",

            lineWidth: 2,

            lineStyle: 2,

            title:
              "VWAP",
          },
        );

      vwap.setData(
        toLineData(
          marketData.series.vwap,
        ),
      );
    }


    // ========================================================
    // SUPPORT
    // ========================================================

    const support =
      chart.addSeries(
        LineSeries,
        {
          color:
            "rgba(239, 68, 68, 0.65)",

          lineWidth: 1,

          lineStyle: 2,

          title:
            "Support",
        },
      );


    support.setData([
      {
        time:
          candles[0].time,

        value:
          marketData.support,
      },

      {
        time:
          candles[
            candles.length - 1
          ].time,

        value:
          marketData.support,
      },
    ]);


    // ========================================================
    // RESISTANCE
    // ========================================================

    const resistance =
      chart.addSeries(
        LineSeries,
        {
          color:
            "rgba(34, 197, 94, 0.65)",

          lineWidth: 1,

          lineStyle: 2,

          title:
            "Resistance",
        },
      );


    resistance.setData([
      {
        time:
          candles[0].time,

        value:
          marketData.resistance,
      },

      {
        time:
          candles[
            candles.length - 1
          ].time,

        value:
          marketData.resistance,
      },
    ]);


    // ========================================================
    // FIT CONTENT
    // ========================================================

    chart.timeScale().fitContent();


    // ========================================================
    // CLEANUP
    // ========================================================

    return () => {
      chart.remove();
    };

  }, [
    marketData,
    showEMA20,
    showEMA50,
    showVWAP,
  ]);


  // ==========================================================
  // UI
  // ==========================================================

  return (
    <div className="chart-wrapper">

      {loading && (
        <div className="chart-overlay">

          <div className="chart-loader" />

          <strong>
            Loading market data...
          </strong>

          <span>
            {symbol} · {timeframe}
          </span>

        </div>
      )}


      {error && !loading && (
        <div className="chart-overlay error">

          <strong>
            Market data unavailable
          </strong>

          <span>
            {error}
          </span>

        </div>
      )}


      {!loading &&
        !error &&
        marketData && (
          <div className="chart-live-badge">
            ● {market === "GLOBAL" ? "YAHOO FINANCE MARKET DATA" : "UPSTOX MARKET DATA"}
          </div>
        )}


      <div
        ref={containerRef}
        className="trading-chart"
      />

    </div>
  );
}[]