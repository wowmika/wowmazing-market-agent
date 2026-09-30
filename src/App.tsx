import { FormEvent, useCallback, useEffect, useState } from "react";
import {
  AlertTriangle,
  Check,
  ChevronDown,
  Clock3,
  Clipboard,
  Search,
  Send,
  Menu,
  Share2,
  Sparkles,
  Sun,
  Moon,
  ShieldAlert,
  Zap,
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
import ResearchEvidencePanel from "./components/ResearchEvidencePanel";
import {
  createResearchRetriever,
  type RetrievedEvidence,
} from "./ai/retrieval";

import "./App.css";
import "./responsive.css";
import "./AgentTerminal.css";
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
  ai_used: boolean;

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
    bullish_score?: number;
    bearish_score?: number;
    support?: number;
    resistance?: number;
    macd_histogram?: number;
    data_provider?: string;
    exchange?: string;
    market?: string;
    currency?: string;
    latest_candle_timestamp?: string | null;
  };

  fundamentals?: FundamentalsData | null;

  error?: string | null;
};



// ============================================================
// STRUCTURED AI AGENT BRIEF
// ============================================================

type AgentBias = "BULLISH" | "BEARISH" | "NEUTRAL";

type AgentTechnicalRead = {
  rsi?: number | null;
  vwap?: number | null;
  ema20?: number | null;
  atr?: number | null;
  macd?: number | null;
  volume_ratio?: number | null;
  price_vs_vwap_pct?: number | null;
  price_vs_ema20_pct?: number | null;
  ema20_vs_ema50_pct?: number | null;
};

type AgentFundamentalRead = {
  name?: string | null;
  provider?: string | null;
  currency?: string | null;
  trailing_pe?: number | null;
  trailing_eps?: number | null;
  revenue_growth?: number | null;
  market_cap?: number | null;
  dividend_yield?: number | null;
};

type AgentBrief = {
  version: string;
  market_view: { bias: AgentBias; title: string; summary: string };
  setup_status: { status: string; technical_evidence_strength: number | null; technical_evidence_basis: string };
  technical_read: AgentTechnicalRead;
  fundamental_context: AgentFundamentalRead;
  catalysts: string[];
  risk: { title: string; summary: string; invalidation: string[] };
  context: { provider: string; timeframe: string; exchange: string; latest_candle_timestamp?: string | null; market: string };
};

type AgentResponseWithBrief = AgentResponse & { brief?: AgentBrief | null };

function normalizeAgentBias(value: unknown): AgentBias {
  const normalized = String(value || "").trim().toUpperCase();
  if (normalized.includes("BULL")) return "BULLISH";
  if (normalized.includes("BEAR")) return "BEARISH";
  return "NEUTRAL";
}

function firstMeaningfulLine(value: string): string {
  return value.split(/\r?\n/).map((line) => line.trim()).find(Boolean) || "";
}

function extractAgentSections(answer: string): Record<string, string> {
  const headings = [
    "MARKET VIEW", "TECHNICAL CONTEXT", "TECHNICAL ANALYSIS", "FUNDAMENTAL CONTEXT",
    "SETUP STATUS", "RISK CONSIDERATIONS", "RISK NOTE", "WHAT TO MONITOR NEXT", "WHAT TO WATCH NEXT",
  ];
  const sections: Record<string, string> = {};
  let current = "";
  for (const rawLine of answer.split(/\r?\n/)) {
    const line = rawLine.trim();
    const heading = headings.find((candidate) => candidate === line.toUpperCase());
    if (heading) { current = heading; sections[current] = ""; continue; }
    if (current) sections[current] = `${sections[current]}${sections[current] ? "\n" : ""}${line}`;
  }
  return sections;
}

function buildFallbackAgentBrief(
  snapshot: AgentResponse["market_snapshot"],
  fundamentals: FundamentalsData | null,
  answer = "",
): AgentBrief {
  const bias = normalizeAgentBias(snapshot.trend);
  const maxTechnicalScore = Math.max(Number(snapshot.bullish_score ?? 0), Number(snapshot.bearish_score ?? 0));
  const pctDelta = (current?: number, reference?: number): number | null => {
    if (current == null || reference == null || reference === 0) return null;
    return ((current - reference) / reference) * 100;
  };
  const sections = extractAgentSections(answer);
  const marketSummary = firstMeaningfulLine(sections["MARKET VIEW"] || "") || `Current technical bias is ${bias.toLowerCase()}.`;
  const setupSummary = firstMeaningfulLine(sections["SETUP STATUS"] || "") || snapshot.signal || "No confirmed setup.";
  const riskSummary = firstMeaningfulLine(sections["RISK CONSIDERATIONS"] || sections["RISK NOTE"] || "") ||
    "Use the technical levels and setup state as invalidation references; this analysis does not guarantee future outcomes.";
  const watchLines = (sections["WHAT TO MONITOR NEXT"] || sections["WHAT TO WATCH NEXT"] || "")
    .split(/\r?\n/)
    .map((line) => line.replace(/^[-•*]\s*/, "").trim())
    .filter(Boolean)
    .slice(0, 6);
  const reasons = Array.isArray((snapshot as Record<string, unknown>).reasons)
    ? ((snapshot as Record<string, unknown>).reasons as string[])
    : [];
  const catalysts = watchLines.length ? watchLines : reasons.slice(0, 4);
  if (!catalysts.length) {
    if (snapshot.support !== undefined) catalysts.push(`Support reference: ${snapshot.support}`);
    if (snapshot.resistance !== undefined) catalysts.push(`Resistance reference: ${snapshot.resistance}`);
    if (snapshot.volume_ratio !== undefined) catalysts.push(`Relative volume: ${snapshot.volume_ratio.toFixed(2)}×`);
  }
  return {
    version: "1.0",
    market_view: { bias, title: bias === "NEUTRAL" ? "Neutral / mixed" : `${bias} technical bias`, summary: marketSummary },
    setup_status: {
      status: setupSummary,
      technical_evidence_strength: Number.isFinite(maxTechnicalScore) ? Math.max(0, Math.min(10, Math.round(maxTechnicalScore * 10) / 10)) : null,
      technical_evidence_basis: "Derived only from the deterministic technical directional score; fundamentals are not included.",
    },
    technical_read: {
      rsi: snapshot.rsi ?? null, vwap: snapshot.vwap ?? null, ema20: snapshot.ema20 ?? null, atr: snapshot.atr ?? null,
      macd: snapshot.macd ?? null, volume_ratio: snapshot.volume_ratio ?? null,
      price_vs_vwap_pct: pctDelta(snapshot.price, snapshot.vwap),
      price_vs_ema20_pct: pctDelta(snapshot.price, snapshot.ema20),
      ema20_vs_ema50_pct: pctDelta(snapshot.ema20, snapshot.ema50),
    },
    fundamental_context: {
      name: fundamentals?.name ?? null, provider: fundamentals?.provider ?? null, currency: fundamentals?.currency ?? null,
      trailing_pe: fundamentals?.trailing_pe ?? null, trailing_eps: fundamentals?.trailing_eps ?? null,
      revenue_growth: fundamentals?.revenue_growth ?? null, market_cap: fundamentals?.market_cap ?? null,
      dividend_yield: fundamentals?.dividend_yield ?? null,
    },
    catalysts,
    risk: {
      title: "Risk / invalidation",
      summary: riskSummary,
      invalidation: [
        snapshot.support !== undefined ? `Support reference: ${snapshot.support}` : "Monitor the nearest structural support.",
        snapshot.resistance !== undefined ? `Resistance reference: ${snapshot.resistance}` : "Monitor the nearest structural resistance.",
        snapshot.atr !== undefined ? `ATR reference: ${snapshot.atr.toFixed(2)}` : "Volatility regime should be reassessed with fresh data.",
      ],
    },
    context: {
      provider: snapshot.data_provider || fundamentals?.provider || "Unknown",
      timeframe: snapshot.timeframe || "—",
      exchange: snapshot.exchange || fundamentals?.exchange || "—",
      latest_candle_timestamp: snapshot.latest_candle_timestamp || null,
      market: snapshot.market || fundamentals?.market || "—",
    },
  };
}

function parseAgentBrief(
  answer: string,
  snapshot: AgentResponse["market_snapshot"],
  fundamentals: FundamentalsData | null,
  serverBrief?: AgentBrief | null,
): AgentBrief {
  const fallback = buildFallbackAgentBrief(snapshot, fundamentals, answer);
  if (!serverBrief) return fallback;
  return {
    ...fallback,
    ...serverBrief,
    market_view: { ...fallback.market_view, ...(serverBrief.market_view || {}), bias: normalizeAgentBias(serverBrief.market_view?.bias || fallback.market_view.bias) },
    setup_status: {
      ...fallback.setup_status,
      ...(serverBrief.setup_status || {}),
      technical_evidence_strength:
        serverBrief.setup_status?.technical_evidence_strength ??
        (serverBrief.setup_status as { actionability_score?: number | null } | undefined)?.actionability_score ??
        fallback.setup_status.technical_evidence_strength,
      technical_evidence_basis:
        serverBrief.setup_status?.technical_evidence_basis ??
        (serverBrief.setup_status as { actionability_basis?: string } | undefined)?.actionability_basis ??
        fallback.setup_status.technical_evidence_basis,
    },
    technical_read: { ...fallback.technical_read, ...(serverBrief.technical_read || {}) },
    fundamental_context: { ...fallback.fundamental_context, ...(serverBrief.fundamental_context || {}) },
    catalysts: serverBrief.catalysts?.length ? serverBrief.catalysts : fallback.catalysts,
    risk: {
      ...fallback.risk,
      ...(serverBrief.risk || {}),
      invalidation: serverBrief.risk?.invalidation?.length ? serverBrief.risk.invalidation : fallback.risk.invalidation,
    },
    context: { ...fallback.context, ...(serverBrief.context || {}) },
  };
}

function formatAgentBriefText(brief: AgentBrief): string {
  const t = brief.technical_read;
  const f = brief.fundamental_context;
  return [
    "WOWMAZING MARKET BRIEF",
    `${brief.market_view.title}: ${brief.market_view.summary}`,
    "",
    `SETUP STATUS: ${brief.setup_status.status}`,
    `TECHNICAL EVIDENCE STRENGTH: ${brief.setup_status.technical_evidence_strength ?? "—"}/10`,
    `RSI: ${t.rsi ?? "—"}`,
    `VWAP: ${t.vwap ?? "—"}`,
    `EMA20: ${t.ema20 ?? "—"}`,
    `ATR: ${t.atr ?? "—"}`,
    "",
    `FUNDAMENTALS: P/E ${f.trailing_pe ?? "—"} · EPS ${f.trailing_eps ?? "—"} · Revenue Growth ${f.revenue_growth ?? "—"}% · Market Cap ${f.market_cap ?? "—"} · Dividend Yield ${f.dividend_yield ?? "—"}%`,
    "",
    "WHAT TO WATCH",
    ...brief.catalysts.map((item) => `• ${item}`),
    "",
    `${brief.risk.title.toUpperCase()}: ${brief.risk.summary}`,
    ...brief.risk.invalidation.map((item) => `• ${item}`),
  ].join("\n");
}

function formatFreshness(timestamp?: string | null): string {
  if (!timestamp) return "Freshness n/a";
  const parsed = new Date(timestamp).getTime();
  if (!Number.isFinite(parsed)) return "Freshness n/a";
  const seconds = Math.max(0, Math.floor((Date.now() - parsed) / 1000));
  if (seconds < 60) return `${seconds}s old`;
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes}m old`;
  return `${Math.floor(minutes / 60)}h old`;
}

function formatSyncTime(timestamp?: number | null): string {
  if (!timestamp) return "—";
  return new Intl.DateTimeFormat("en-IN", {
    timeZone: "Asia/Kolkata",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hour12: false,
  }).format(new Date(timestamp));
}

type CashMarketState = {
  isOpen: boolean;
  label: string;
  detail: string;
};

function getIndiaCashMarketState(now = new Date()): CashMarketState {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: "Asia/Kolkata",
    weekday: "short",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  }).formatToParts(now);

  const weekday = parts.find((part) => part.type === "weekday")?.value || "";
  const hour = Number(parts.find((part) => part.type === "hour")?.value || 0);
  const minute = Number(parts.find((part) => part.type === "minute")?.value || 0);
  const totalMinutes = hour * 60 + minute;
  const weekdayOpen = weekday !== "Sat" && weekday !== "Sun";
  const isOpen = weekdayOpen && totalMinutes >= 9 * 60 + 15 && totalMinutes <= 15 * 60 + 30;

  if (isOpen) {
    return {
      isOpen: true,
      label: "LIVE FEED",
      detail: "Indian cash session 09:15–15:30 IST",
    };
  }

  return {
    isOpen: false,
    label: "MARKET CLOSED",
    detail: "Indian cash session 09:15–15:30 IST",
  };
}

type ChartCrosshairReadout = {
  time: number | null;
  open: number | null;
  high: number | null;
  low: number | null;
  close: number | null;
  ema20: number | null;
  ema50: number | null;
  vwap: number | null;
};

function formatChartTime(timestamp: number | null): string {
  if (!timestamp) return "Hover over a candle";
  return new Intl.DateTimeFormat("en-IN", {
    timeZone: "Asia/Kolkata",
    day: "2-digit",
    month: "short",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  }).format(new Date(timestamp * 1000));
}

type FundamentalsData = {
  success: boolean;
  supported: boolean;
  message?: string;
  provider?: string;
  symbol?: string;
  resolved_symbol?: string;
  market?: string;
  retrieved_at?: string;
  name?: string;
  sector?: string | null;
  industry?: string | null;
  currency?: string;
  exchange?: string;
  trailing_pe?: number | null;
  forward_pe?: number | null;
  price_to_book?: number | null;
  market_cap?: number | null;
  enterprise_value?: number | null;
  trailing_eps?: number | null;
  revenue?: number | null;
  revenue_growth?: number | null;
  profit_margin?: number | null;
  operating_margin?: number | null;
  dividend_yield?: number | null;
  beta?: number | null;
  debt_to_equity?: number | null;
  return_on_equity?: number | null;
  fifty_two_week_low?: number | null;
  fifty_two_week_high?: number | null;
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

function formatCompactMoney(
  value: number,
  currency: string,
): string {
  const normalized = currency.toUpperCase();
  const symbol =
    CURRENCY_SYMBOLS[normalized] || `${normalized} `;

  return `${symbol}${value.toLocaleString("en-IN", {
    notation: "compact",
    maximumFractionDigits: 2,
  })}`;
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

  const [agentEvidence, setAgentEvidence] =
    useState<RetrievedEvidence[]>([]);

  const [agentRetrievalRuntime, setAgentRetrievalRuntime] =
    useState<"webgpu" | "wasm" | null>(null);

  const [agentRetrievalLoading, setAgentRetrievalLoading] =
    useState(false);

  const [agentFundamentals, setAgentFundamentals] =
    useState<FundamentalsData | null>(null);
  const [agentBrief, setAgentBrief] =
    useState<AgentBrief | null>(null);
  const [agentLatencyMs, setAgentLatencyMs] =
    useState<number | null>(null);
  const [agentClock, setAgentClock] =
    useState(() => Date.now());
  const [agentSyncAt, setAgentSyncAt] =
    useState<number | null>(null);
  const [agentAiUsed, setAgentAiUsed] =
    useState(false);
  const [agentAuditExpanded, setAgentAuditExpanded] =
    useState(false);
  const [agentActionFeedback, setAgentActionFeedback] =
    useState("");
  const [agentTechnicalExpanded, setAgentTechnicalExpanded] =
    useState(false);
  const [agentChecks, setAgentChecks] =
    useState<Record<string, boolean>>({});
  const [chartTransitioning, setChartTransitioning] =
    useState(false);
  const [crosshairReadout, setCrosshairReadout] =
    useState<ChartCrosshairReadout | null>(null);

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

  const [fundamentals, setFundamentals] =
    useState<FundamentalsData | null>(null);

  const [fundamentalsLoading, setFundamentalsLoading] =
    useState(false);

  const [fundamentalsError, setFundamentalsError] =
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

  const changeTimeframe = (nextTimeframe: string) => {
    if (nextTimeframe === timeframe) return;
    setChartTransitioning(true);
    setCrosshairReadout(null);
    setTimeframe(nextTimeframe);
    window.setTimeout(() => setChartTransitioning(false), 260);
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

  // ==========================================================
  // FUNDAMENTALS
  // ==========================================================

  useEffect(() => {
    const controller = new AbortController();

    const loadFundamentals = async () => {
      setFundamentalsLoading(true);
      setFundamentalsError("");

      try {
        const response = await fetch(
          `${API_BASE_URL}/fundamentals?symbol=${encodeURIComponent(
            symbol,
          )}&market=${encodeURIComponent(
            instrumentMeta.market,
          )}`,
          {
            signal: controller.signal,
          },
        );

        if (!response.ok) {
          throw new Error(
            `Backend returned HTTP ${response.status}.`,
          );
        }

        const data =
          (await response.json()) as FundamentalsData;

        if (!controller.signal.aborted) {
          setFundamentals(data);

          if (
            data.currency &&
            instrumentMeta.market === "GLOBAL"
          ) {
            setCurrency(data.currency);
          }
        }
      } catch (error) {
        if (controller.signal.aborted) {
          return;
        }

        setFundamentals(null);
        setFundamentalsError(
          error instanceof Error
            ? error.message
            : "Unable to load fundamentals.",
        );
      } finally {
        if (!controller.signal.aborted) {
          setFundamentalsLoading(false);
        }
      }
    };

    void loadFundamentals();

    return () => {
      controller.abort();
    };
  }, [symbol, instrumentMeta.market]);


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


  useEffect(() => {
    if (!agentOpen) return;
    const interval = window.setInterval(() => setAgentClock(Date.now()), 1000);
    return () => window.clearInterval(interval);
  }, [agentOpen]);


  // ==========================================================
  // AGENT
  // ==========================================================

  const openAgent = (
    starterCommand = "",
  ) => {

    setCommand(starterCommand);
    setAgentAnswer("");
    setAgentEvidence([]);
    setAgentRetrievalRuntime(null);
    setAgentRetrievalLoading(false);
    setAgentFundamentals(null);
    setAgentBrief(null);
    setAgentLatencyMs(null);
    setAgentSyncAt(null);
    setAgentAiUsed(false);
    setAgentAuditExpanded(false);
    setAgentActionFeedback("");
    setAgentTechnicalExpanded(false);
    setAgentChecks({});
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
    setAgentEvidence([]);
    setAgentRetrievalRuntime(null);
    setAgentRetrievalLoading(false);
    setAgentBrief(null);
    setAgentActionFeedback("");
    setAgentTechnicalExpanded(false);
    setAgentAuditExpanded(false);
    setAgentChecks({});
    setAgentError("");

    const requestStartedAt = performance.now();

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
        (await response.json()) as AgentResponseWithBrief;

      const elapsedMs = Math.round(performance.now() - requestStartedAt);
      setAgentLatencyMs(elapsedMs);
      setAgentSyncAt(Date.now());
      setAgentAiUsed(Boolean(data.ai_used));

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

      const nextSnapshot =
        data.market_snapshot ||
        {};
      const nextFundamentals =
        data.fundamentals ||
        null;

      setAgentFundamentals(
        nextFundamentals,
      );
      setSnapshot(
        nextSnapshot,
      );

      // ========================================================
      // PHASE 2 — BROWSER LOCAL RETRIEVAL
      // ========================================================
      // The backend remains authoritative for market numbers,
      // indicators, fundamentals, and strategy data. The browser
      // creates a local evidence index and retrieves the material
      // most relevant to the user query.
      setAgentRetrievalLoading(true);

      void (async () => {
        try {
          const retriever =
            await createResearchRetriever({
              command: cleanCommand,
              market_snapshot: nextSnapshot,
              fundamentals: nextFundamentals,
              strategy_evidence: strategyEvidence
                ? (strategyEvidence as unknown as Record<string, unknown>)
                : null,
            });

          const retrievedEvidence =
            await retriever.search(
              cleanCommand,
              {
                limit: 8,
                symbol:
                  typeof nextSnapshot.symbol === "string"
                    ? nextSnapshot.symbol
                    : undefined,
              },
            );

          setAgentEvidence(
            retrievedEvidence,
          );
          setAgentRetrievalRuntime(
            retriever.runtime,
          );
        } catch (retrievalError) {
          console.error(
            "WOWMAZING browser retrieval failed:",
            retrievalError,
          );
          setAgentEvidence([]);
          setAgentRetrievalRuntime(null);
        } finally {
          setAgentRetrievalLoading(false);
        }
      })();

      setAgentBrief(
        parseAgentBrief(
          data.answer || "",
          nextSnapshot,
          nextFundamentals,
          data.brief || null,
        ),
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

  const indiaMarketState =
    instrumentMeta.market === "INDIA" || instrumentMeta.market === "INDEX"
      ? getIndiaCashMarketState(new Date(agentClock))
      : null;

  const providerLabel =
    (agentBrief?.context.provider ||
      snapshot.data_provider ||
      agentFundamentals?.provider ||
      "MARKET FEED").toUpperCase();

  const statusLabel = indiaMarketState?.label || "MARKET CONTEXT";

  const statusDetail = indiaMarketState?.isOpen
    ? `${providerLabel} • LIVE FEED • ${agentLatencyMs ?? "—"}ms`
    : `${providerLabel} • ${statusLabel} • LAST SYNC ${formatSyncTime(agentSyncAt)}`;

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
                    changeTimeframe(item)
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
                {fundamentalsLoading
                  ? "Loading company fundamentals…"
                  : fundamentalsError
                    ? fundamentalsError
                    : fundamentals?.supported
                      ? `Source: ${
                          fundamentals.provider ||
                          "fundamentals feed"
                        }`
                      : fundamentals?.message ||
                        "Fundamentals unavailable for this instrument."}
              </span>
            </div>

            <div className="key-metrics-grid">
              <Metric
                label="TTM P / E"
                value={
                  fundamentals?.trailing_pe != null
                    ? fundamentals.trailing_pe.toFixed(2)
                    : "—"
                }
                detail={
                  fundamentals?.forward_pe != null
                    ? `Forward P/E ${fundamentals.forward_pe.toFixed(2)}`
                    : "Valuation"
                }
              />

              <Metric
                label="MARKET CAP"
                value={
                  fundamentals?.market_cap != null
                    ? formatCompactMoney(
                        fundamentals.market_cap,
                        fundamentals.currency || currency,
                      )
                    : "—"
                }
                detail={
                  fundamentals?.name ||
                  "Equity valuation"
                }
              />

              <Metric
                label="52W RANGE"
                value={
                  fundamentals?.fifty_two_week_low != null &&
                  fundamentals?.fifty_two_week_high != null
                    ? `${formatMoney(
                        fundamentals.fifty_two_week_low,
                        fundamentals.currency || currency,
                      )} – ${formatMoney(
                        fundamentals.fifty_two_week_high,
                        fundamentals.currency || currency,
                      )}`
                    : "—"
                }
                detail={
                  fundamentals?.exchange ||
                  fundamentals?.resolved_symbol ||
                  "Price range"
                }
              />

              <Metric
                label="EPS (TTM)"
                value={
                  fundamentals?.trailing_eps != null
                    ? formatMoney(
                        fundamentals.trailing_eps,
                        fundamentals.currency || currency,
                      )
                    : "—"
                }
                detail="Per-share earnings"
              />

              <Metric
                label="REVENUE GROWTH"
                value={
                  fundamentals?.revenue_growth != null
                    ? `${fundamentals.revenue_growth.toFixed(2)}%`
                    : "—"
                }
                detail="Year-over-year"
              />

              <Metric
                label="DIVIDEND YIELD"
                value={
                  fundamentals?.dividend_yield != null
                    ? `${fundamentals.dividend_yield.toFixed(2)}%`
                    : "—"
                }
                detail="Trailing yield"
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

            <div className="chart-terminal-toolbar">
              <div className="chart-indicator-legend" aria-label="Indicator visibility">
                {[
                  ["EMA20", "EMA 20"],
                  ["EMA50", "EMA 50"],
                  ["VWAP", "VWAP"],
                ].map(([shortLabel, key]) => {
                  const active = Boolean(indicators[key]);
                  return (
                    <button
                      key={key}
                      type="button"
                      className={`chart-indicator-toggle ${active ? "is-active" : ""}`}
                      onClick={() => toggleIndicator(key)}
                      aria-pressed={active}
                      title={`Toggle ${key}`}
                    >
                      <span className={`chart-indicator-dot ${shortLabel.toLowerCase()}`} />
                      {shortLabel}
                    </button>
                  );
                })}
              </div>

              <div className="chart-crosshair-readout" aria-live="polite">
                <span className="chart-readout-time">{formatChartTime(crosshairReadout?.time ?? null)}</span>
                {crosshairReadout ? (
                  <>
                    <span>O {crosshairReadout.open?.toFixed(2) ?? "—"}</span>
                    <span>H {crosshairReadout.high?.toFixed(2) ?? "—"}</span>
                    <span>L {crosshairReadout.low?.toFixed(2) ?? "—"}</span>
                    <span>C {crosshairReadout.close?.toFixed(2) ?? "—"}</span>
                    <span>EMA20 {crosshairReadout.ema20?.toFixed(2) ?? "—"}</span>
                    <span>EMA50 {crosshairReadout.ema50?.toFixed(2) ?? "—"}</span>
                    <span>VWAP {crosshairReadout.vwap?.toFixed(2) ?? "—"}</span>
                  </>
                ) : (
                  <span>Crosshair readout ready</span>
                )}
              </div>
            </div>

            <div className={`chart-interaction-shell ${chartTransitioning ? "is-transitioning" : ""}`}>
              <TradingChart
                symbol={symbol}
                timeframe={timeframe}
                market={instrumentMeta.market}
                showEMA20={Boolean(indicators["EMA 20"])}
                showEMA50={Boolean(indicators["EMA 50"])}
                showVWAP={Boolean(indicators.VWAP)}
                onCrosshairDataChange={setCrosshairReadout}
              />
            </div>
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
          AGENT MODAL — INSTITUTIONAL RESEARCH TERMINAL
      ==================================================== */}

      {agentOpen && (
        <div
          className="agent-overlay agent-terminal-overlay"
          onClick={closeAgent}
          role="dialog"
          aria-modal="true"
          aria-label="WOWMAZING AI Research Terminal"
        >
          <div
            className="agent-modal agent-terminal-modal"
            onClick={(event) => event.stopPropagation()}
          >
            <div className="agent-terminal-header">
              <div className="agent-terminal-title-row">
                <div className="agent-terminal-brand">
                  <div className="agent-command-icon agent-terminal-icon">
                    <Sparkles size={17} />
                  </div>
                  <div>
                    <span className="agent-terminal-kicker">AI RESEARCH TERMINAL</span>
                    <h2>Ask WOWMAZING</h2>
                  </div>
                </div>
                <button
                  type="button"
                  className="agent-icon-button"
                  onClick={closeAgent}
                  disabled={agentLoading}
                  aria-label="Close AI research terminal"
                  title="Close"
                >
                  <X size={17} />
                </button>
              </div>

              <div className="agent-terminal-statusbar">
                <div className="agent-status-cluster">
                  <span className={`agent-market-state-line ${indiaMarketState?.isOpen ? "is-open" : "is-closed"}`}>
                    {indiaMarketState?.isOpen ? <Zap size={11} /> : <Clock3 size={11} />}
                    {statusDetail}
                  </span>
                  {agentSyncAt && !indiaMarketState?.isOpen && (
                    <span className="agent-status-metric agent-status-secondary">
                      {formatFreshness(new Date(agentSyncAt).toISOString())}
                    </span>
                  )}
                </div>

                <div className="agent-timeframe-chips" aria-label="Quick timeframe context">
                  {["5m", "15m", "1D"].map((quickFrame) => (
                    <button
                      key={quickFrame}
                      type="button"
                      className={`agent-timeframe-chip ${timeframe === quickFrame ? "is-active" : ""}`}
                      onClick={() => {
                        changeTimeframe(quickFrame);
                        setCommand(`Analyze ${symbol} on ${quickFrame}.`);
                      }}
                    >
                      {quickFrame}
                    </button>
                  ))}
                </div>
              </div>
            </div>

            <div className="agent-terminal-scroll">
              <form onSubmit={sendToAgent} className="agent-terminal-command-form">
                <div className="agent-terminal-commandbar">
                  <Sparkles size={16} />
                  <input
                    autoFocus
                    value={command}
                    onChange={(event) => setCommand(event.target.value)}
                    placeholder={`Analyze ${symbol} on ${timeframe}...`}
                    disabled={agentLoading}
                    aria-label="Agent command"
                  />
                  <button
                    type="submit"
                    disabled={agentLoading || !command.trim()}
                    className="agent-terminal-send"
                    title="Run analysis"
                  >
                    {agentLoading ? <span className="spinner" /> : <Send size={15} />}
                  </button>
                </div>
              </form>

              {agentError && (
                <div className="agent-terminal-error" role="alert">
                  <AlertTriangle size={15} />
                  <span>{agentError}</span>
                </div>
              )}

              {!agentAnswer && !agentLoading && !agentError && (
                <div className="agent-terminal-welcome">
                  <div className="agent-welcome-orb">
                    <Sparkles size={22} />
                  </div>
                  <div>
                    <span className="agent-terminal-kicker">RESEARCH WORKSPACE</span>
                    <h3>Command the market context.</h3>
                    <p>
                      Ask for a current setup read, technical explanation, fundamentals,
                      or the next conditions worth monitoring.
                    </p>
                  </div>
                  <div className="agent-suggestion-grid">
                    {[
                      `Analyze ${symbol} on ${timeframe}.`,
                      `Explain the current technical conditions for ${symbol}.`,
                      `Summarize the fundamental context for ${symbol}.`,
                      `What should I watch next for ${symbol}?`,
                    ].map((suggestion) => (
                      <button
                        key={suggestion}
                        type="button"
                        onClick={() => setCommand(suggestion)}
                      >
                        <span>{suggestion}</span>
                        <ChevronDown size={14} />
                      </button>
                    ))}
                  </div>
                </div>
              )}

              {agentLoading && (
                <div className="agent-terminal-loading">
                  <div className="agent-loading-ring" />
                  <strong>Building institutional market brief</strong>
                  <span>Synchronizing technicals, fundamentals, and evidence layers.</span>
                </div>
              )}

              {agentBrief && !agentLoading && (
                <div className="agent-terminal-brief">
                  <section className="agent-brief-hero">
                    <div className="agent-section-meta">
                      <span className="agent-terminal-kicker">MARKET VIEW</span>
                      <span className="agent-source-label">
                        {agentBrief.context.market} · {agentBrief.context.exchange}
                      </span>
                    </div>
                    <div className="agent-hero-main">
                      <div>
                        <div className="agent-bias-line">
                          <span className={`agent-bias-pill ${agentBrief.market_view.bias.toLowerCase()}`}>
                            <span className="agent-bias-dot" />
                            {agentBrief.market_view.bias}
                          </span>
                          <span className="agent-outline-pill">{agentBrief.setup_status.status}</span>
                        </div>
                        <h3>{agentBrief.market_view.title}</h3>
                        <p>{agentBrief.market_view.summary}</p>
                      </div>

                      <div className="agent-evidence-strength-card">
                        <span>TECHNICAL EVIDENCE STRENGTH</span>
                        <strong>
                          {agentBrief.setup_status.technical_evidence_strength ?? "—"}
                          <small>/10</small>
                        </strong>
                        <div className="agent-progress-track">
                          <span
                            style={{
                              width: `${Math.max(0, Math.min(10, agentBrief.setup_status.technical_evidence_strength ?? 0)) * 10}%`,
                            }}
                          />
                        </div>
                        <em>{agentBrief.setup_status.technical_evidence_basis}</em>
                      </div>
                    </div>
                  </section>

                  <section className="agent-terminal-section">
                    <div className="agent-section-heading">
                      <div>
                        <span className="agent-terminal-kicker">TECHNICAL READ</span>
                        <h3>Signal matrix</h3>
                      </div>
                      <button
                        type="button"
                        className={`agent-accordion-trigger ${agentTechnicalExpanded ? "is-open" : ""}`}
                        onClick={() => setAgentTechnicalExpanded((current) => !current)}
                        aria-expanded={agentTechnicalExpanded}
                      >
                        <span>{agentTechnicalExpanded ? "Hide depth" : "Deep technical evidence"}</span>
                        <ChevronDown size={15} />
                      </button>
                    </div>

                    <div className="agent-metric-grid agent-technical-grid">
                      <AgentMetricCard
                        label="RSI"
                        value={agentBrief.technical_read.rsi != null ? agentBrief.technical_read.rsi.toFixed(2) : "—"}
                        badge={
                          agentBrief.technical_read.rsi == null
                            ? undefined
                            : agentBrief.technical_read.rsi < 30
                              ? "Oversold"
                              : agentBrief.technical_read.rsi > 70
                                ? "Overbought"
                                : "Neutral"
                        }
                        tone={
                          agentBrief.technical_read.rsi == null
                            ? "neutral"
                            : agentBrief.technical_read.rsi < 30
                              ? "positive"
                              : agentBrief.technical_read.rsi > 70
                                ? "negative"
                                : "neutral"
                        }
                        detail="Relative strength"
                      />
                      <AgentMetricCard
                        label="VWAP"
                        value={agentBrief.technical_read.vwap != null ? formatMoney(agentBrief.technical_read.vwap, currency) : "—"}
                        badge={
                          agentBrief.technical_read.price_vs_vwap_pct != null
                            ? `${agentBrief.technical_read.price_vs_vwap_pct >= 0 ? "+" : ""}${agentBrief.technical_read.price_vs_vwap_pct.toFixed(2)}%`
                            : undefined
                        }
                        tone={
                          agentBrief.technical_read.price_vs_vwap_pct == null
                            ? "neutral"
                            : agentBrief.technical_read.price_vs_vwap_pct >= 0
                              ? "positive"
                              : "negative"
                        }
                        detail="Price vs VWAP"
                      />
                      <AgentMetricCard
                        label="EMA 20"
                        value={agentBrief.technical_read.ema20 != null ? formatMoney(agentBrief.technical_read.ema20, currency) : "—"}
                        badge={
                          agentBrief.technical_read.price_vs_ema20_pct != null
                            ? `${agentBrief.technical_read.price_vs_ema20_pct >= 0 ? "+" : ""}${agentBrief.technical_read.price_vs_ema20_pct.toFixed(2)}%`
                            : undefined
                        }
                        tone={
                          agentBrief.technical_read.price_vs_ema20_pct == null
                            ? "neutral"
                            : agentBrief.technical_read.price_vs_ema20_pct >= 0
                              ? "positive"
                              : "negative"
                        }
                        detail="Price vs EMA20"
                      />
                      <AgentMetricCard
                        label="ATR"
                        value={agentBrief.technical_read.atr != null ? agentBrief.technical_read.atr.toFixed(2) : "—"}
                        badge={snapshot.volume_ratio != null ? `${snapshot.volume_ratio.toFixed(2)}× vol` : undefined}
                        tone="neutral"
                        detail="Volatility reference"
                      />
                    </div>

                    <div className={`agent-deep-tech ${agentTechnicalExpanded ? "is-open" : ""}`}>
                      <div className="agent-deep-tech-inner">
                        <div className="agent-deep-tech-grid">
                          <AgentDetailRow label="MACD" value={agentBrief.technical_read.macd != null ? agentBrief.technical_read.macd.toFixed(2) : "—"} />
                          <AgentDetailRow label="Relative volume" value={agentBrief.technical_read.volume_ratio != null ? `${agentBrief.technical_read.volume_ratio.toFixed(2)}×` : "—"} />
                          <AgentDetailRow label="Price vs VWAP" value={agentBrief.technical_read.price_vs_vwap_pct != null ? `${agentBrief.technical_read.price_vs_vwap_pct >= 0 ? "+" : ""}${agentBrief.technical_read.price_vs_vwap_pct.toFixed(2)}%` : "—"} />
                          <AgentDetailRow label="Price vs EMA20" value={agentBrief.technical_read.price_vs_ema20_pct != null ? `${agentBrief.technical_read.price_vs_ema20_pct >= 0 ? "+" : ""}${agentBrief.technical_read.price_vs_ema20_pct.toFixed(2)}%` : "—"} />
                          <AgentDetailRow label="EMA20 vs EMA50" value={agentBrief.technical_read.ema20_vs_ema50_pct != null ? `${agentBrief.technical_read.ema20_vs_ema50_pct >= 0 ? "+" : ""}${agentBrief.technical_read.ema20_vs_ema50_pct.toFixed(2)}%` : "—"} />
                          <AgentDetailRow label="Last price" value={snapshot.price != null ? formatMoney(snapshot.price, currency) : "—"} />
                        </div>
                      </div>
                    </div>
                  </section>

                  <section className="agent-terminal-section">
                    <div className="agent-section-heading">
                      <div>
                        <span className="agent-terminal-kicker">PHASE-3 FUNDAMENTAL CONTEXT</span>
                        <h3>{agentBrief.fundamental_context.name || "Company fundamentals"}</h3>
                      </div>
                      <span className="agent-source-label">
                        {agentBrief.fundamental_context.provider || "Unavailable"}
                      </span>
                    </div>

                    <div className="agent-metric-grid agent-fundamental-grid">
                      <AgentMetricCard
                        label="P / E"
                        value={agentBrief.fundamental_context.trailing_pe != null ? agentBrief.fundamental_context.trailing_pe.toFixed(2) : "—"}
                        detail="TTM valuation"
                      />
                      <AgentMetricCard
                        label="EPS"
                        value={agentBrief.fundamental_context.trailing_eps != null ? formatMoney(agentBrief.fundamental_context.trailing_eps, agentBrief.fundamental_context.currency || currency) : "—"}
                        detail="TTM earnings"
                      />
                      <AgentMetricCard
                        label="REVENUE GROWTH"
                        value={agentBrief.fundamental_context.revenue_growth != null ? `${agentBrief.fundamental_context.revenue_growth.toFixed(2)}%` : "—"}
                        detail="Year over year"
                        tone={agentBrief.fundamental_context.revenue_growth != null && agentBrief.fundamental_context.revenue_growth >= 0 ? "positive" : "negative"}
                      />
                      <AgentMetricCard
                        label="MARKET CAP"
                        value={agentBrief.fundamental_context.market_cap != null ? formatCompactMoney(agentBrief.fundamental_context.market_cap, agentBrief.fundamental_context.currency || currency) : "—"}
                        detail="Equity valuation"
                      />
                      <AgentMetricCard
                        label="DIVIDEND YIELD"
                        value={agentBrief.fundamental_context.dividend_yield != null ? `${agentBrief.fundamental_context.dividend_yield.toFixed(2)}%` : "—"}
                        detail="Trailing yield"
                      />
                    </div>
                  </section>

                  <ResearchEvidencePanel
                    evidence={agentEvidence}
                    runtime={agentRetrievalRuntime}
                    loading={agentRetrievalLoading}
                  />

                  <section className="agent-terminal-section">
                    <div className="agent-section-heading">
                      <div>
                        <span className="agent-terminal-kicker">RESEARCH WATCHLIST</span>
                        <h3>Key catalysts / what to watch</h3>
                      </div>
                      <span className="agent-source-label">
                        {Object.values(agentChecks).filter(Boolean).length}/{agentBrief.catalysts.length} acknowledged
                      </span>
                    </div>
                    <div className="agent-watchlist">
                      {agentBrief.catalysts.map((item, index) => {
                        const key = `${index}-${item}`;
                        const checked = Boolean(agentChecks[key]);
                        return (
                          <button
                            type="button"
                            className={`agent-watch-item ${checked ? "is-checked" : ""}`}
                            key={key}
                            onClick={() =>
                              setAgentChecks((current) => ({
                                ...current,
                                [key]: !current[key],
                              }))
                            }
                          >
                            <span className="agent-check-box">
                              {checked && <Check size={12} />}
                            </span>
                            <span>{item}</span>
                          </button>
                        );
                      })}
                    </div>
                  </section>

                  <section className="agent-terminal-section agent-research-timeline">
                    <div className="agent-section-heading">
                      <div>
                        <span className="agent-terminal-kicker">RESEARCH TIMELINE</span>
                        <h3>Context & catalyst flow</h3>
                      </div>
                      <span className="agent-source-label">SOURCE-AWARE</span>
                    </div>
                    <div className="agent-timeline-list">
                      <div className="agent-timeline-item">
                        <span className="agent-timeline-node current" />
                        <div>
                          <span>MARKET STATE</span>
                          <strong>{agentBrief.market_view.title}</strong>
                          <small>
                            {agentBrief.context.latest_candle_timestamp
                              ? formatChartTime(Math.floor(new Date(agentBrief.context.latest_candle_timestamp).getTime() / 1000))
                              : "Latest available candle"}
                          </small>
                        </div>
                      </div>
                      <div className="agent-timeline-item">
                        <span className="agent-timeline-node fundamental" />
                        <div>
                          <span>FUNDAMENTAL SNAPSHOT</span>
                          <strong>{agentBrief.fundamental_context.provider || "Unavailable"}</strong>
                          <small>Company KPI context supplied by the fundamentals layer</small>
                        </div>
                      </div>
                      {agentBrief.catalysts.slice(0, 3).map((item, index) => (
                        <div className="agent-timeline-item" key={`timeline-${index}-${item}`}>
                          <span className="agent-timeline-node watch" />
                          <div>
                            <span>WATCHPOINT {index + 1}</span>
                            <strong>{item}</strong>
                            <small>Monitor as fresh market data arrives</small>
                          </div>
                        </div>
                      ))}
                    </div>
                  </section>

                  <section className={`agent-audit-section ${agentAuditExpanded ? "is-open" : ""}`}>
                    <button
                      type="button"
                      className="agent-audit-trigger"
                      onClick={() => setAgentAuditExpanded((current) => !current)}
                      aria-expanded={agentAuditExpanded}
                    >
                      <span>
                        <span className="agent-terminal-kicker">AI REASONING AUDIT</span>
                        <strong>How this brief is assembled</strong>
                      </span>
                      <ChevronDown size={15} />
                    </button>
                    <div className="agent-audit-panel">
                      <div className="agent-audit-grid">
                        <AgentDetailRow label="Technical source" value="Deterministic market analysis" />
                        <AgentDetailRow label="Fundamental source" value={agentBrief.fundamental_context.provider || "Unavailable"} />
                        <AgentDetailRow label="AI role" value={agentAiUsed ? "Narrative interpretation only" : "Deterministic fallback"} />
                        <AgentDetailRow label="Numeric source-lock" value="Enabled" />
                        <AgentDetailRow label="Combined score" value="Not used" />
                        <AgentDetailRow label="Historical evidence" value="Not a next-trade probability" />
                      </div>
                    </div>
                  </section>

                  <section className="agent-risk-banner">
                    <div className="agent-risk-icon">
                      <ShieldAlert size={18} />
                    </div>
                    <div>
                      <span className="agent-terminal-kicker">RISK / INVALIDATION</span>
                      <h3>{agentBrief.risk.title}</h3>
                      <p>{agentBrief.risk.summary}</p>
                      <div className="agent-invalidation-list">
                        {agentBrief.risk.invalidation.map((item) => (
                          <span key={item}>{item}</span>
                        ))}
                      </div>
                    </div>
                  </section>

                  <div className="agent-terminal-footer-actions">
                    <div className="agent-terminal-context-note">
                      <span>{agentBrief.context.provider}</span>
                      <span>•</span>
                      <span>{agentBrief.context.timeframe}</span>
                      <span>•</span>
                      <span>{formatFreshness(agentBrief.context.latest_candle_timestamp)}</span>
                    </div>

                    <div className="agent-quick-actions">
                      <button
                        type="button"
                        onClick={async () => {
                          const text = formatAgentBriefText(agentBrief);
                          try {
                            await navigator.clipboard.writeText(text);
                            setAgentActionFeedback("Brief copied");
                          } catch {
                            setAgentActionFeedback("Copy unavailable");
                          }
                          window.setTimeout(() => setAgentActionFeedback(""), 1800);
                        }}
                      >
                        <Clipboard size={14} />
                        Copy Brief
                      </button>
                      <button
                        type="button"
                        onClick={async () => {
                          const title = `WOWMAZING ${symbol} ${timeframe} Analysis`;
                          const text = formatAgentBriefText(agentBrief);
                          try {
                            if (navigator.share) {
                              await navigator.share({ title, text });
                              setAgentActionFeedback("Analysis shared");
                            } else {
                              await navigator.clipboard.writeText(text);
                              setAgentActionFeedback("Brief copied");
                            }
                          } catch {
                            setAgentActionFeedback("Share cancelled");
                          }
                          window.setTimeout(() => setAgentActionFeedback(""), 1800);
                        }}
                      >
                        <Share2 size={14} />
                        Share Analysis
                      </button>
                      <button
                        type="button"
                        onClick={() => {
                          setAgentAnswer("");
                          setAgentEvidence([]);
                          setAgentRetrievalRuntime(null);
                          setAgentRetrievalLoading(false);
                          setAgentBrief(null);
                          setAgentFundamentals(null);
                          setAgentAiUsed(false);
                          setAgentSyncAt(null);
                          setAgentAuditExpanded(false);
                          setAgentActionFeedback("");
                          setAgentTechnicalExpanded(false);
                          setAgentChecks({});
                          setAgentError("");
                          window.setTimeout(() => {
                            document.querySelector<HTMLInputElement>(".agent-terminal-commandbar input")?.focus();
                          }, 0);
                        }}
                      >
                        <Sparkles size={14} />
                        New Analysis
                      </button>
                    </div>
                  </div>

                  {agentActionFeedback && (
                    <div className="agent-action-feedback" role="status">
                      <Check size={13} />
                      {agentActionFeedback}
                    </div>
                  )}
                </div>
              )}
            </div>
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
// AGENT TERMINAL COMPONENTS
// ============================================================

function AgentMetricCard({
  label,
  value,
  detail,
  badge,
  tone = "neutral",
  mono = true,
}: {
  label: string;
  value: string;
  detail: string;
  badge?: string;
  tone?: "positive" | "negative" | "neutral";
  mono?: boolean;
}) {
  return (
    <div className="agent-metric-card">
      <div className="agent-metric-card-top">
        <span>{label}</span>
        {badge && <span className={`agent-metric-badge ${tone}`}>{badge}</span>}
      </div>
      <strong className={mono ? "agent-number" : ""}>{value}</strong>
      <small>{detail}</small>
    </div>
  );
}

function AgentDetailRow({
  label,
  value,
}: {
  label: string;
  value: string;
}) {
  return (
    <div className="agent-detail-row">
      <span>{label}</span>
      <strong>{value}</strong>
    </div>
  );
}


export default App;