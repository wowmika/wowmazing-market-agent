import type { ResearchAtom, ResearchContextInput, ResearchAtomType } from "./types";

const text = (value: unknown): string | null => {
  const s = String(value ?? "").trim();
  return s || null;
};

const number = (value: unknown): number | null => {
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
};

const makeAtom = (
  input: Omit<ResearchAtom, "importance"> & { importance?: number },
): ResearchAtom => ({
  ...input,
  importance: Math.max(0, Math.min(1, input.importance ?? 0.5)),
});

export function buildEvidenceAtoms(context: ResearchContextInput): ResearchAtom[] {
  const snapshot = context.market_snapshot ?? {};
  const fundamentals = context.fundamentals ?? {};
  const strategy = context.strategy_evidence ?? {};
  const symbol = text(snapshot.symbol) ?? text(snapshot.requested_symbol) ?? "UNKNOWN";
  const timeframe = text(snapshot.timeframe);
  const exchange = text(snapshot.exchange);
  const market = text(snapshot.market);
  const timestamp = text(snapshot.latest_candle_timestamp);
  const provider = text(snapshot.data_provider) ?? "deterministic-engine";
  const atoms: ResearchAtom[] = [];

  const add = (
    id: string,
    title: string,
    value: unknown,
    source: string,
    type: ResearchAtomType,
    importance: number,
  ) => {
    const valueText = text(value);
    if (!valueText) return;
    atoms.push(makeAtom({
      id, symbol, type, title,
      text: `${title}: ${valueText}.`,
      source, timestamp, timeframe, exchange, market, importance,
    }));
  };

  add("market-price", "Price", snapshot.price, provider, "market", 1);
  add("market-change", "Change", number(snapshot.change_pct) == null ? null : `${number(snapshot.change_pct)!.toFixed(2)}%`, provider, "market", 0.7);
  add("technical-trend", "Technical trend", snapshot.trend, "deterministic-technical-engine", "technical", 0.95);
  add("technical-signal", "Setup signal", snapshot.signal, "deterministic-technical-engine", "strategy", 0.95);
  add("technical-rsi", "RSI", snapshot.rsi, "deterministic-technical-engine", "technical", 0.95);
  add("technical-ema20", "EMA20", snapshot.ema20, "deterministic-technical-engine", "technical", 0.9);
  add("technical-ema50", "EMA50", snapshot.ema50, "deterministic-technical-engine", "technical", 0.8);
  add("technical-vwap", "VWAP", snapshot.vwap, "deterministic-technical-engine", "technical", 0.9);
  add("technical-atr", "ATR", snapshot.atr, "deterministic-technical-engine", "technical", 0.8);
  add("technical-macd", "MACD", snapshot.macd, "deterministic-technical-engine", "technical", 0.75);
  add("technical-volume", "Relative volume", snapshot.volume_ratio, "deterministic-technical-engine", "technical", 0.75);
  add("technical-support", "Support", snapshot.support, "deterministic-technical-engine", "technical", 0.8);
  add("technical-resistance", "Resistance", snapshot.resistance, "deterministic-technical-engine", "technical", 0.8);
  add("technical-bullish-score", "Bullish technical score", snapshot.bullish_score, "deterministic-technical-engine", "strategy", 0.7);
  add("technical-bearish-score", "Bearish technical score", snapshot.bearish_score, "deterministic-technical-engine", "strategy", 0.7);

  if (Array.isArray(snapshot.reasons)) {
    snapshot.reasons.map(text).filter((v): v is string => Boolean(v)).slice(0, 8).forEach((reason, i) => {
      atoms.push(makeAtom({
        id: `technical-reason-${i + 1}`,
        symbol,
        type: "technical",
        title: "Technical evidence",
        text: reason,
        source: "deterministic-technical-engine",
        timestamp, timeframe, exchange, market,
        importance: 0.72,
      }));
    });
  }

  const fundamentalsSource = text(fundamentals.provider) ?? "fundamentals-engine";
  const fundamentalFields: Array<[string, string, unknown, number]> = [
    ["fundamental-company", "Company", fundamentals.name, 0.65],
    ["fundamental-pe", "Trailing P/E", fundamentals.trailing_pe, 0.82],
    ["fundamental-forward-pe", "Forward P/E", fundamentals.forward_pe, 0.65],
    ["fundamental-eps", "EPS", fundamentals.trailing_eps, 0.8],
    ["fundamental-revenue-growth", "Revenue growth", fundamentals.revenue_growth, 0.85],
    ["fundamental-profit-margin", "Profit margin", fundamentals.profit_margin, 0.72],
    ["fundamental-operating-margin", "Operating margin", fundamentals.operating_margin, 0.65],
    ["fundamental-market-cap", "Market cap", fundamentals.market_cap, 0.75],
    ["fundamental-dividend", "Dividend yield", fundamentals.dividend_yield, 0.55],
    ["fundamental-beta", "Beta", fundamentals.beta, 0.55],
    ["fundamental-debt-equity", "Debt / equity", fundamentals.debt_to_equity, 0.7],
    ["fundamental-roe", "Return on equity", fundamentals.return_on_equity, 0.65],
  ];
  for (const [id, title, value, importance] of fundamentalFields) {
    add(id, title, value, fundamentalsSource, "fundamental", importance);
  }

  for (const key of ["summary", "message"]) {
    const value = text(strategy[key]);
    if (value) {
      atoms.push(makeAtom({
        id: `strategy-${key}`,
        symbol, type: "strategy", title: "Strategy evidence", text: value,
        source: "strategy-evidence", timestamp, timeframe, exchange, market,
        importance: 0.9,
      }));
      break;
    }
  }

  if (Array.isArray(strategy.reasons)) {
    strategy.reasons.map(text).filter((v): v is string => Boolean(v)).slice(0, 8).forEach((reason, i) => {
      atoms.push(makeAtom({
        id: `strategy-reason-${i + 1}`,
        symbol, type: "strategy", title: "Strategy evidence", text: reason,
        source: "strategy-evidence", timestamp, timeframe, exchange, market,
        importance: 0.82,
      }));
    });
  }

  if (Array.isArray(context.research)) {
    context.research.slice(0, 20).forEach((item, i) => {
      const body = text(item.text);
      if (!body) return;
      atoms.push(makeAtom({
        id: `research-${i + 1}`,
        symbol, type: "research", title: text(item.title) ?? "Research source",
        text: body, source: text(item.source) ?? "research-source",
        sourceUrl: item.url ?? null, timestamp: item.published_at ?? null,
        timeframe, exchange, market, importance: 0.85,
      }));
    });
  }

  return atoms;
}
