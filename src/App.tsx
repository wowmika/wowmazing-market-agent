import { FormEvent, useCallback, useEffect, useState } from "react";
import {
  ChevronDown,
  Clock3,
  Search,
  Send,
  Menu,
  Sparkles,
  Sun,
  Moon,
  X,
} from "lucide-react";

import Sidebar from "./components/Sidebar";
import TradingChart from "./components/TradingChart";
import MarketStructure from "./components/MarketStructure";
import PositionPlanner from "./components/PositionPlanner";
import StrategyEvidence, {
  StrategyEvidenceData,
} from "./StrategyEvidence";
import LearningCenter from "./LearningCenter";

import "./App.css";
import "./responsive.css";
import { API_BASE_URL } from "./config";


// ============================================================
// TIMEFRAMES
// ============================================================

const timeframes = [
  "1m",
  "3m",
  "5m",
  "15m",
  "30m",
  "1H",
  "4H",
  "1D",
  "1W",
];


// ============================================================
// INDICATORS
// ============================================================

const initialIndicators: Record<
  string,
  boolean
> = {
  "EMA 20": true,
  "EMA 50": true,
  "EMA 200": false,
  VWAP: true,
  Supertrend: false,
  RSI: true,
  MACD: true,
  Stochastic: false,
  ATR: true,
  "Bollinger Bands": false,
  Volume: true,
  OBV: false,
  MFI: false,
};


// ============================================================
// AGENT RESPONSE
// ============================================================

type AgentResponse = {
  success: boolean;
  answer: string;

  market_snapshot: {
    symbol?: string;
    timeframe?: string;
    price?: number;
    change?: number;
    change_pct?: number;
    ema20?: number;
    ema50?: number;
    ema200?: number;
    rsi?: number;
    macd?: number;
    macd_signal?: number;
    vwap?: number;
    atr?: number;
    volume_ratio?: number;
    trend?: string;
    signal?: string;
  };

  error?: string | null;
};


type StrategyEvidenceApiResponse = StrategyEvidenceData & {
  market_context?: {
    requested_symbol?: string;
    resolved_symbol?: string;
    instrument_key?: string;
    segment?: string;
    data_provider?: string;
    data_note?: string;
    timeframe?: string;
    latest_candle?: string | null;
    quote?: Record<string, unknown>;
    analysis?: AgentResponse["market_snapshot"];
    currency?: string;
    exchange?: string;
    country?: string;
    provider?: string;
  };
};


// ============================================================
// CURRENCY HELPERS
// ============================================================

const CURRENCY_SYMBOLS: Record<string, string> = {
  INR: "₹",
  USD: "$",
  EUR: "€",
  GBP: "£",
  JPY: "¥",
  HKD: "HK$",
  CAD: "C$",
  AUD: "A$",
  SGD: "S$",
  CNY: "¥",
  CHF: "CHF ",
};

function inferCurrencyFromSymbol(
  symbol: string,
  market?: InstrumentMeta["market"],
): string {
  const upper = symbol.toUpperCase();

  if (upper.endsWith(".NS") || upper.endsWith(".BO")) return "INR";
  if (upper === "NIFTY 50" || upper === "BANKNIFTY" || upper === "^NSEI" || upper === "^NSEBANK") return "INR";

  if (upper.endsWith(".L")) return "GBP";
  if (upper.endsWith(".DE") || upper.endsWith(".F")) return "EUR";
  if (upper.endsWith(".T")) return "JPY";
  if (upper.endsWith(".HK")) return "HKD";
  if (upper.endsWith(".TO")) return "CAD";
  if (upper.endsWith(".AX")) return "AUD";
  if (upper.endsWith(".SI")) return "SGD";
  if (upper.endsWith(".SS") || upper.endsWith(".SZ")) return "CNY";

  // Plain symbols are NSE by default in this app. A global symbol
  // selected through universal search carries market metadata, so
  // only then should an unsuffixed symbol fall back to USD.
  return market === "GLOBAL" ? "USD" : "INR";
}

function formatMoney(value: number, currency: string): string {
  const normalized = currency.toUpperCase();
  const symbol = CURRENCY_SYMBOLS[normalized] || `${normalized} `;

  return `${symbol}${value.toLocaleString("en-IN", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  })}`;
}

type InstrumentMeta = {
  market: "INDIA" | "GLOBAL" | "INDEX";
  currency: string;
  exchange?: string;
  provider?: string;
};

function inferInstrumentMeta(symbol: string): InstrumentMeta {
  const upper = symbol.toUpperCase();

  if (upper === "NIFTY 50" || upper === "BANKNIFTY" || upper.startsWith("^NSE")) {
    return { market: "INDEX", currency: "INR" };
  }

  if (upper.endsWith(".NS") || upper.endsWith(".BO")) {
    return {
      market: "INDIA",
      currency: "INR",
      exchange: upper.endsWith(".BO") ? "BSE" : "NSE",
    };
  }

  // Ordinary watchlist symbols remain NSE by default. Global
  // symbols are marked explicitly by universal search.
  return { market: "INDIA", currency: "INR", exchange: "NSE" };
}

// ============================================================
// APP
// ============================================================

function App() {

  const [symbol, setSymbol] =
    useState("RELIANCE");

  const [timeframe, setTimeframe] =
    useState("15m");

  const [indicators, setIndicators] =
    useState(initialIndicators);

  const [agentOpen, setAgentOpen] =
    useState(false);

  const [command, setCommand] =
    useState("");

  const [agentAnswer, setAgentAnswer] =
    useState("");

  const [agentLoading, setAgentLoading] =
    useState(false);

  const [agentError, setAgentError] =
    useState("");

  const [snapshot, setSnapshot] =
    useState<
      AgentResponse["market_snapshot"]
    >({});

  const [currency, setCurrency] =
    useState(() => inferCurrencyFromSymbol("RELIANCE"));

  const [instrumentMeta, setInstrumentMeta] =
    useState<InstrumentMeta>(() => inferInstrumentMeta("RELIANCE"));


  const [strategyEvidence, setStrategyEvidence] =
    useState<StrategyEvidenceData | null>(null);

  const [strategyEvidenceLoading, setStrategyEvidenceLoading] =
    useState(false);

  const [strategyEvidenceError, setStrategyEvidenceError] =
    useState("");

  // Responsive navigation drawer state.
  const [mobileSidebarOpen, setMobileSidebarOpen] =
    useState(false);

  const [learningCenterOpen, setLearningCenterOpen] =
    useState(false);


  // Visual theme state. This changes presentation only; all market,
  // strategy, chart, and backend logic remains unchanged.
  const [theme, setTheme] = useState<"dark" | "light">(() => {
    const saved = window.localStorage.getItem("wowmazing-theme");
    return saved === "light" ? "light" : "dark";
  });


  // ==========================================================
  // INDICATOR TOGGLE
  // ==========================================================

  const toggleIndicator = (
    name: string,
  ) => {

    setIndicators((current) => ({
      ...current,
      [name]: !current[name],
    }));
  };


  // ==========================================================
  // API SYMBOL
  // ==========================================================

  const apiSymbol =
    instrumentMeta.market === "GLOBAL"
      ? symbol
      : symbol === "NIFTY 50"
        ? "^NSEI"
        : symbol === "BANKNIFTY"
          ? "^NSEBANK"
          : symbol.includes(".NS") ||
              symbol.includes(".BO") ||
              symbol.startsWith("^") ||
              symbol.includes(".")
            ? symbol
            : `${symbol}.NS`;

  // Keep BSE suffixes and global provider symbols intact.
  // Strip only the NSE suffix for the strategy engine, which
  // uses the plain Indian ticker as its default research symbol.
  const strategySymbol =
    symbol.endsWith(".NS")
      ? symbol.slice(0, -3)
      : symbol;

  // ==========================================================
  // LIVE STRATEGY EVIDENCE
  // ==========================================================

  const refreshStrategyEvidence =
    useCallback(
      async () => {

        setStrategyEvidenceLoading(true);
        setStrategyEvidenceError("");

        try {

          const response =
            await fetch(
              `${API_BASE_URL}/strategy/evidence?symbol=${encodeURIComponent(
                strategySymbol,
              )}&timeframe=${encodeURIComponent(
                timeframe,
              )}&market=${encodeURIComponent(
                instrumentMeta.market,
              )}`,
            );

          if (!response.ok) {

            throw new Error(
              `Backend returned HTTP ${response.status}.`,
            );

          }

          const data =
            (await response.json()) as StrategyEvidenceApiResponse;

          setStrategyEvidence(data);

          // Strategy Evidence and the dashboard header now use the
          // same market analysis object produced from the same
          // Upstox data load. This removes stale/demo values from
          // the top-level dashboard metrics.
          if (data.market_context?.analysis) {
            setSnapshot(data.market_context.analysis);
          }

          // Indian watchlist/index instruments are always INR in the UI.
          // For global instruments, preserve the currency returned by the
          // search metadata/backend. This prevents a missing or incorrect
          // backend currency from turning RELIANCE into a USD quote.
          const backendCurrency =
            instrumentMeta.market === "GLOBAL"
              ? (data.market_context?.currency ||
                instrumentMeta.currency ||
                inferCurrencyFromSymbol(symbol, "GLOBAL"))
              : instrumentMeta.currency || "INR";

          setCurrency(backendCurrency);
          setInstrumentMeta((current) => ({
            ...current,
            currency: backendCurrency,
            exchange: data.market_context?.exchange || current.exchange,
            provider: data.market_context?.provider || current.provider,
          }));

        } catch (error) {

          const message =
            error instanceof Error
              ? error.message
              : "Unknown error.";

          setStrategyEvidenceError(
            message,
          );

        } finally {

          setStrategyEvidenceLoading(false);

        }

      },
      [
        strategySymbol,
        timeframe,
        instrumentMeta.market,
      ],
    );

  useEffect(() => {
    if (instrumentMeta.market !== "GLOBAL") {
      const fallback = inferInstrumentMeta(symbol);
      setInstrumentMeta((current) => ({
        ...current,
        ...fallback,
      }));
      setCurrency(fallback.currency);
    }
  }, [symbol]);

  useEffect(
    () => {
      void refreshStrategyEvidence();
    },
    [refreshStrategyEvidence],
  );

  // Close the mobile navigation with Escape and prevent the
  // page from scrolling behind the open drawer.
  useEffect(() => {
    document.documentElement.dataset.theme = theme;
    window.localStorage.setItem("wowmazing-theme", theme);
  }, [theme]);


  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        setMobileSidebarOpen(false);
        setLearningCenterOpen(false);
      }
    };

    window.addEventListener("keydown", handleKeyDown);

    document.body.classList.toggle(
      "sidebar-open",
      mobileSidebarOpen,
    );

    return () => {
      window.removeEventListener("keydown", handleKeyDown);
      document.body.classList.remove("sidebar-open");
    };
  }, [mobileSidebarOpen]);


  // ==========================================================
  // AGENT
  // ==========================================================

  const openAgent = (
    starterCommand = "",
  ) => {

    setCommand(starterCommand);
    setAgentAnswer("");
    setAgentError("");
    setAgentOpen(true);
  };


  const closeAgent = () => {

    if (agentLoading) {
      return;
    }

    setAgentOpen(false);
  };


  const sendToAgent = async (
    event?: FormEvent,
  ) => {

    event?.preventDefault();

    const cleanCommand =
      command.trim();

    if (!cleanCommand) {

      setAgentError(
        "Please enter a command for the agent.",
      );

      return;
    }

    setAgentLoading(true);
    setAgentAnswer("");
    setAgentError("");

    try {

      const response =
        await fetch(
          `${API_BASE_URL}/agent`,
          {
            method: "POST",

            headers: {
              "Content-Type":
                "application/json",
            },

            body: JSON.stringify({
              command: cleanCommand,
              symbol: apiSymbol,
              timeframe,
              market: instrumentMeta.market,
            }),
          },
        );

      if (!response.ok) {

        throw new Error(
          `Backend returned HTTP ${response.status}.`,
        );
      }

      const data =
        (await response.json()) as AgentResponse;

      if (!data.success) {

        throw new Error(
          data.error ||
            "The agent could not complete the request.",
        );
      }

      setAgentAnswer(
        data.answer ||
          "No answer returned.",
      );

      setSnapshot(
        data.market_snapshot ||
          {},
      );

    } catch (error) {

      const message =
        error instanceof Error
          ? error.message
          : "Unknown error.";

      setAgentError(
        `Agent connection failed: ${message}`,
      );

    } finally {

      setAgentLoading(false);
    }
  };


  // ==========================================================
  // RENDER
  // ==========================================================

  const displayPrice =
    snapshot.price !== undefined
      ? formatMoney(snapshot.price, currency)
      : "—";

  const displayChangePct =
    snapshot.change_pct !== undefined
      ? `${snapshot.change_pct >= 0 ? "+" : ""}${snapshot.change_pct.toFixed(2)}%`
      : "—";

  const marketMoveTone =
    snapshot.change_pct === undefined
      ? "wait"
      : snapshot.change_pct >= 0
        ? "positive"
        : "negative";

  const technicalSentiment =
    snapshot.trend ||
    "NEUTRAL";

  return (
    <div
      className="app-shell"
      data-theme={theme}
    >
      {/* ====================================================
          SIDEBAR
      ==================================================== */}

      <Sidebar
        symbol={symbol}
        setSymbol={setSymbol}
        onInstrumentMeta={(meta) => {
          setInstrumentMeta({
            market: meta.market,
            currency:
              meta.currency ||
              inferCurrencyFromSymbol(
                symbol,
                meta.market,
              ),
            exchange: meta.exchange,
            provider: meta.provider,
          });
        }}
        onOpenLearningCenter={() => {
          setMobileSidebarOpen(false);
          setLearningCenterOpen(true);
        }}
        indicators={indicators}
        toggleIndicator={toggleIndicator}
        mobileOpen={mobileSidebarOpen}
        onClose={() =>
          setMobileSidebarOpen(false)
        }
      />

      {mobileSidebarOpen && (
        <button
          type="button"
          className="mobile-sidebar-backdrop"
          aria-label="Close navigation"
          onClick={() =>
            setMobileSidebarOpen(false)
          }
        />
      )}

      {learningCenterOpen && (
        <LearningCenter
          onClose={() =>
            setLearningCenterOpen(false)
          }
        />
      )}

      {/* ====================================================
          MAIN
      ==================================================== */}

      <main className="main-area">
        {/* ==================================================
            TOP BAR
        ================================================== */}

        <header className="topbar">
          <button
            type="button"
            className="mobile-menu-button"
            aria-label="Open navigation"
            aria-expanded={mobileSidebarOpen}
            onClick={() =>
              setMobileSidebarOpen(true)
            }
          >
            <Menu size={17} />
            <span>Menu</span>
          </button>

          <div className="topbar-market">
            <div className="market-label">
              {instrumentMeta.market === "GLOBAL"
                ? "GLOBAL MARKET"
                : instrumentMeta.market === "INDEX"
                  ? "INDEX MARKET"
                  : instrumentMeta.exchange ===
                      "BSE"
                    ? "BSE CASH MARKET"
                    : "NSE CASH MARKET"}
            </div>

            <div className="symbol-row">
              <div className="symbol-heading">
                <div className="ticker-line">
                  <h1>{symbol}</h1>
                  <span className="market-pill">
                    {instrumentMeta.market ===
                    "GLOBAL"
                      ? "GLOBAL"
                      : instrumentMeta.market ===
                          "INDEX"
                        ? "INDEX"
                        : instrumentMeta.exchange ===
                            "BSE"
                          ? "BSE"
                          : "NSE"}
                  </span>
                </div>

                <p>
                  {symbol === "RELIANCE"
                    ? "Reliance Industries"
                    : "Selected instrument"}
                </p>
              </div>

              <div className="price-box">
                <strong>
                  {displayPrice}
                </strong>

                <span
                  className={marketMoveTone}
                >
                  {displayChangePct}
                </span>
              </div>
            </div>
          </div>

          <div className="top-actions">
            <button
              type="button"
              className="theme-toggle"
              aria-label={
                theme === "dark"
                  ? "Switch to light mode"
                  : "Switch to dark mode"
              }
              onClick={() =>
                setTheme((current) =>
                  current === "dark"
                    ? "light"
                    : "dark",
                )
              }
            >
              {theme === "dark" ? (
                <Sun size={16} />
              ) : (
                <Moon size={16} />
              )}
            </button>

            <div className="engine-badge">
              <span className="status-dot" />
              ENGINE ONLINE
            </div>

            <button
              className="ask-agent"
              onClick={() =>
                openAgent(
                  `Analyze ${symbol} on ${timeframe}.`,
                )
              }
            >
              <Sparkles size={15} />
              Ask Agent
            </button>
          </div>
        </header>

        {/* ==================================================
            CONTENT
        ================================================== */}

        <div className="content">
          <section className="toolbar">
            <div className="timeframe-bar">
              {timeframes.map((item) => (
                <button
                  key={item}
                  className={
                    timeframe === item
                      ? "timeframe active"
                      : "timeframe"
                  }
                  onClick={() =>
                    setTimeframe(item)
                  }
                >
                  {item}
                </button>
              ))}
            </div>

            <div className="analysis-settings">
              <button className="setting-button">
                <Clock3 size={14} />
                Primary {timeframe}
                <ChevronDown size={13} />
              </button>

              <button className="setting-button">
                <Clock3 size={14} />
                Confirm 1H
                <ChevronDown size={13} />
              </button>

              <button className="setting-button">
                Risk 1%
                <ChevronDown size={13} />
              </button>
            </div>
          </section>

          {/* ==================================================
              OVERVIEW
          ================================================== */}

          <section className="dashboard-section overview-section">
            <div className="section-heading-block">
              <div>
                <span className="eyebrow">
                  OVERVIEW
                </span>
                <h2>
                  {symbol} market overview
                </h2>
              </div>

              <span className="data-status-pill">
                {strategyEvidenceLoading
                  ? "Updating"
                  : "Live data"}
              </span>
            </div>

            <div className="overview-grid">
              <article className="overview-card overview-price-card">
                <span className="metric-label">
                  CURRENT PRICE
                </span>

                <strong className="overview-price">
                  {displayPrice}
                </strong>

                <div
                  className={`overview-change ${marketMoveTone}`}
                >
                  {displayChangePct}
                  <span>
                    {snapshot.change !==
                    undefined
                      ? `${snapshot.change >= 0 ? "+" : ""}${formatMoney(
                          Math.abs(
                            snapshot.change,
                          ),
                          currency,
                        )} today`
                      : "Awaiting change data"}
                  </span>
                </div>

                <div className="overview-meta-row">
                  <span>
                    {instrumentMeta.exchange ||
                      instrumentMeta.market}
                  </span>
                  <span>
                    {timeframe}
                  </span>
                  <span>
                    {currency}
                  </span>
                </div>
              </article>

              <article className="overview-card">
                <div className="card-inline-heading">
                  <div>
                    <span className="metric-label">
                      MARKET BIAS
                    </span>
                    <strong
                      className={
                        snapshot.trend ===
                        "BULLISH"
                          ? "positive"
                          : snapshot.trend ===
                              "BEARISH"
                            ? "negative"
                            : "wait"
                      }
                    >
                      {technicalSentiment}
                    </strong>
                  </div>

                  <span className="soft-pill">
                    Technical
                  </span>
                </div>

                <div className="overview-mini-grid">
                  <div>
                    <span>RSI</span>
                    <strong>
                      {snapshot.rsi !==
                      undefined
                        ? snapshot.rsi.toFixed(
                            2,
                          )
                        : "—"}
                    </strong>
                  </div>

                  <div>
                    <span>SIGNAL</span>
                    <strong
                      className={
                        snapshot.signal ===
                        "BUY"
                          ? "positive"
                          : snapshot.signal ===
                              "SELL"
                            ? "negative"
                            : ""
                      }
                    >
                      {snapshot.signal ||
                        "—"}
                    </strong>
                  </div>

                  <div>
                    <span>VOLUME</span>
                    <strong>
                      {snapshot.volume_ratio !==
                      undefined
                        ? `${snapshot.volume_ratio.toFixed(2)}×`
                        : "—"}
                    </strong>
                  </div>

                  <div>
                    <span>ATR</span>
                    <strong>
                      {snapshot.atr !==
                      undefined
                        ? snapshot.atr.toFixed(
                            2,
                          )
                        : "—"}
                    </strong>
                  </div>
                </div>
              </article>
            </div>
          </section>

          {/* ==================================================
              KEY METRICS
          ================================================== */}

          <section className="dashboard-section">
            <div className="section-heading-block compact">
              <div>
                <span className="eyebrow">
                  KEY METRICS
                </span>
                <h2>
                  Fundamentals & technicals
                </h2>
              </div>

              <span className="section-note">
                Fundamentals fields require a
                fundamentals feed.
              </span>
            </div>

            <div className="key-metrics-grid">
              <Metric
                label="P / E"
                value="—"
                detail="Fundamentals unavailable"
              />

              <Metric
                label="MARKET CAP"
                value="—"
                detail="Fundamentals unavailable"
              />

              <Metric
                label="52W RANGE"
                value="—"
                detail="Fundamentals unavailable"
              />

              <Metric
                label="RSI"
                value={
                  snapshot.rsi !==
                  undefined
                    ? snapshot.rsi.toFixed(
                        2,
                      )
                    : "—"
                }
                detail="Momentum"
              />

              <Metric
                label="EMA 20"
                value={
                  snapshot.ema20 !==
                  undefined
                    ? formatMoney(
                        snapshot.ema20,
                        currency,
                      )
                    : "—"
                }
                detail="Trend"
              />

              <Metric
                label="EMA 50"
                value={
                  snapshot.ema50 !==
                  undefined
                    ? formatMoney(
                        snapshot.ema50,
                        currency,
                      )
                    : "—"
                }
                detail="Trend"
              />
            </div>
          </section>

          {/* ==================================================
              CHART
          ================================================== */}

          <section className="dashboard-section terminal-card chart-card">
            <div className="card-header">
              <div>
                <span className="eyebrow">
                  PRICE ACTION
                </span>

                <h2>
                  Interactive chart
                </h2>
              </div>

              <div className="chart-tools">
                <span>
                  {instrumentMeta.market ===
                  "GLOBAL"
                    ? "GLOBAL"
                    : instrumentMeta.market ===
                        "INDEX"
                      ? "INDEX"
                      : instrumentMeta.exchange ===
                          "BSE"
                        ? "BSE"
                        : "NSE"}
                </span>

                <button
                  type="button"
                  aria-label="Search chart"
                >
                  <Search size={13} />
                </button>

                <button
                  type="button"
                  aria-label="Chart settings"
                >
                  <ChevronDown
                    size={13}
                  />
                </button>
              </div>
            </div>

            <TradingChart
              symbol={symbol}
              timeframe={timeframe}
              market={instrumentMeta.market}
              showEMA20={
                indicators["EMA 20"]
              }
              showEMA50={
                indicators["EMA 50"]
              }
              showVWAP={
                indicators.VWAP
              }
            />
          </section>

          {/* ==================================================
              TECHNICAL METRICS
          ================================================== */}

          <section className="dashboard-section">
            <div className="section-heading-block compact">
              <div>
                <span className="eyebrow">
                  TECHNICAL SNAPSHOT
                </span>
                <h2>
                  Signals at a glance
                </h2>
              </div>
            </div>

            <div className="technical-metrics-grid">
              <Metric
                label="MACD"
                value={
                  snapshot.macd !==
                  undefined
                    ? snapshot.macd.toFixed(
                        2,
                      )
                    : "—"
                }
                detail="Quant engine"
              />

              <Metric
                label="VWAP"
                value={
                  snapshot.vwap !==
                  undefined
                    ? formatMoney(
                        snapshot.vwap,
                        currency,
                      )
                    : "—"
                }
                detail="Chart indicator"
              />

              <Metric
                label="ATR"
                value={
                  snapshot.atr !==
                  undefined
                    ? snapshot.atr.toFixed(
                        2,
                      )
                    : "—"
                }
                detail="Volatility"
              />

              <Metric
                label="REL. VOLUME"
                value={
                  snapshot.volume_ratio !==
                  undefined
                    ? `${snapshot.volume_ratio.toFixed(2)}×`
                    : "—"
                }
                detail="Current / average"
              />

              <Metric
                label="EMA 20"
                value={
                  snapshot.ema20 !==
                  undefined
                    ? formatMoney(
                        snapshot.ema20,
                        currency,
                      )
                    : "—"
                }
                detail="Trend"
              />

              <Metric
                label="EMA 50"
                value={
                  snapshot.ema50 !==
                  undefined
                    ? formatMoney(
                        snapshot.ema50,
                        currency,
                      )
                    : "—"
                }
                detail="Trend"
              />
            </div>
          </section>

          {/* ==================================================
              MARKET STRUCTURE
          ================================================== */}

          <section className="dashboard-section">
            <div className="section-heading-block compact">
              <div>
                <span className="eyebrow">
                  MARKET STRUCTURE
                </span>
                <h2>
                  Price structure & position planning
                </h2>
              </div>
            </div>

            <MarketStructure />
            <PositionPlanner />
          </section>

          {/* ==================================================
              STRATEGY EVIDENCE
          ================================================== */}

          <section className="dashboard-section terminal-card evidence-card-wrapper">
            <div className="card-header">
              <div>
                <span className="eyebrow">
                  STRATEGY RESEARCH
                </span>

                <h2>
                  Strategy Evidence
                </h2>
              </div>

              <div className="chart-tools">
                <span>
                  BACKTEST LAB
                </span>
              </div>
            </div>

            <StrategyEvidence
              evidence={
                strategyEvidence ??
                undefined
              }
              loading={
                strategyEvidenceLoading
              }
              onRunBacktest={
                refreshStrategyEvidence
              }
            />

            {strategyEvidenceError && (
              <div className="evidence-api-error">
                Live strategy evidence unavailable:{" "}
                {strategyEvidenceError}
              </div>
            )}
          </section>

          {/* ==================================================
              NEWS / SENTIMENT
          ================================================== */}

          <section className="dashboard-section news-sentiment-card">
            <div className="section-heading-block">
              <div>
                <span className="eyebrow">
                  NEWS & SENTIMENT
                </span>

                <h2>
                  Research context
                </h2>
              </div>

              <span className="soft-pill">
                Feed status
              </span>
            </div>

            <div className="news-layout">
              <div className="sentiment-panel">
                <span className="metric-label">
                  TECHNICAL SENTIMENT
                </span>

                <strong
                  className={
                    snapshot.trend ===
                    "BULLISH"
                      ? "positive"
                      : snapshot.trend ===
                          "BEARISH"
                        ? "negative"
                        : "wait"
                  }
                >
                  {technicalSentiment}
                </strong>

                <p>
                  This is derived from the
                  current technical snapshot,
                  not from external news.
                </p>
              </div>

              <div className="news-placeholder">
                <div className="placeholder-icon">
                  <Search size={17} />
                </div>

                <div>
                  <strong>
                    Live news feed is not connected
                  </strong>

                  <span>
                    No headlines or external
                    sentiment are being invented
                    here. Connect a news provider
                    when that data source is
                    available.
                  </span>
                </div>
              </div>
            </div>
          </section>

          {/* ==================================================
              AGENT COMMAND BAR
          ================================================== */}

          <section className="agent-command-bar">
            <div className="agent-command-icon">
              <Sparkles size={17} />
            </div>

            <div>
              <strong>
                Ask WOWMAZING Market Agent
              </strong>

              <span>
                Try: “Analyze {symbol} on{" "}
                {timeframe}.”
              </span>
            </div>

            <button
              onClick={() =>
                openAgent(
                  `Analyze ${symbol} on ${timeframe}.`,
                )
              }
            >
              Open Agent
            </button>
          </section>

          <footer className="app-footer">
            <span>
              WOWMAZING Market Agent V1
            </span>

            <span>
              Research terminal · AI-assisted
              decision support
            </span>
          </footer>
        </div>
      </main>

      {/* ====================================================
          AGENT MODAL
      ==================================================== */}

      {agentOpen && (
        <div
          className="agent-overlay"
          onClick={closeAgent}
        >
          <div
            className="agent-modal"
            onClick={(event) =>
              event.stopPropagation()
            }
          >
            <div className="agent-modal-top">
              <div>
                <span className="eyebrow">
                  AI COMMAND CENTER
                </span>

                <h2>
                  Ask WOWMAZING
                </h2>
              </div>

              <button
                type="button"
                onClick={closeAgent}
                disabled={agentLoading}
                aria-label="Close agent"
              >
                <X size={17} />
              </button>
            </div>

            <form onSubmit={sendToAgent}>
              <div className="agent-input">
                <Sparkles size={17} />

                <input
                  autoFocus
                  value={command}
                  onChange={(event) =>
                    setCommand(
                      event.target.value,
                    )
                  }
                  placeholder={`Analyze ${symbol} on ${timeframe}...`}
                  disabled={agentLoading}
                />

                <button
                  type="submit"
                  disabled={
                    agentLoading ||
                    !command.trim()
                  }
                  className="agent-send"
                >
                  {agentLoading ? (
                    <span className="spinner" />
                  ) : (
                    <Send size={15} />
                  )}
                </button>
              </div>
            </form>

            {agentError && (
              <div className="agent-error">
                {agentError}
              </div>
            )}

            {!agentAnswer &&
              !agentLoading &&
              !agentError && (
                <div className="agent-suggestions">
                  <button
                    type="button"
                    onClick={() =>
                      setCommand(
                        `Analyze ${symbol} on ${timeframe}.`,
                      )
                    }
                  >
                    Analyze current setup
                  </button>

                  <button
                    type="button"
                    onClick={() =>
                      setCommand(
                        `Explain the current technical conditions for ${symbol}.`,
                      )
                    }
                  >
                    Explain the current conditions
                  </button>

                  <button
                    type="button"
                    onClick={() =>
                      setCommand(
                        `What should I watch next for ${symbol}?`,
                      )
                    }
                  >
                    Tell me what to watch next
                  </button>
                </div>
              )}

            {agentLoading && (
              <div className="agent-loading">
                <div className="loading-orb" />

                <strong>
                  Market Agent is analyzing...
                </strong>

                <span>
                  Fetching market data and preparing
                  the response.
                </span>
              </div>
            )}

            {agentAnswer &&
              !agentLoading && (
                <div className="agent-result">
                  <div className="agent-result-header">
                    <div>
                      <span>
                        AGENT RESPONSE
                      </span>

                      <strong>
                        {snapshot.symbol ||
                          apiSymbol}
                      </strong>
                    </div>

                    <div className="agent-result-timeframe">
                      {snapshot.timeframe ||
                        timeframe}
                    </div>
                  </div>

                  <div className="agent-answer">
                    {agentAnswer
                      .split("\n")
                      .map((line, index) => (
                        <p
                          key={`${index}-${line}`}
                        >
                          {line ||
                            "\u00A0"}
                        </p>
                      ))}
                  </div>

                  <div className="agent-snapshot">
                    <SnapshotItem
                      label="PRICE"
                      value={
                        snapshot.price !==
                        undefined
                          ? formatMoney(
                              snapshot.price,
                              currency,
                            )
                          : "--"
                      }
                    />

                    <SnapshotItem
                      label="TREND"
                      value={
                        snapshot.trend ||
                        "--"
                      }
                    />

                    <SnapshotItem
                      label="RSI"
                      value={
                        snapshot.rsi !==
                        undefined
                          ? snapshot.rsi.toFixed(
                              2,
                            )
                          : "--"
                      }
                    />

                    <SnapshotItem
                      label="VOL"
                      value={
                        snapshot.volume_ratio !==
                        undefined
                          ? `${snapshot.volume_ratio.toFixed(2)}×`
                          : "--"
                      }
                    />
                  </div>

                  <button
                    type="button"
                    className="agent-new-command"
                    onClick={() => {
                      setAgentAnswer("");
                      setAgentError("");
                    }}
                  >
                    Ask another question
                  </button>
                </div>
              )}
          </div>
        </div>
      )}
    </div>
  );
}


// ============================================================
// GENERIC METRIC
// ============================================================

function Metric({
  label,
  value,
  detail,
  tone = "",
}: {
  label: string;
  value: string;
  detail: string;
  tone?: string;
}) {

  return (
    <div className="metric-card">

      <span>
        {label}
      </span>

      <strong className={tone}>
        {value}
      </strong>

      <small>
        {detail}
      </small>

    </div>
  );
}


// ============================================================
// AGENT SNAPSHOT
// ============================================================

function SnapshotItem({
  label,
  value,
}: {
  label: string;
  value: string;
}) {

  return (
    <div className="snapshot-item">

      <span>
        {label}
      </span>

      <strong>
        {value}
      </strong>

    </div>
  );
}


export default App;