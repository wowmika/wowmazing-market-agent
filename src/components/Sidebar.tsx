import {
  Activity,
  BarChart3,
  Bell,
  BookOpen,
  BriefcaseBusiness,
  ChevronDown,
  ChevronRight,
  Gauge,
  LineChart,
  Moon,
  Search,
  Settings2,
  ShieldCheck,
  Sun,
  Wallet,
  X,
} from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { API_BASE_URL } from "../config";

type SidebarProps = {
  symbol: string;
  setSymbol: (symbol: string) => void;
  indicators: Record<string, boolean>;
  toggleIndicator: (name: string) => void;
  onOpenLearningCenter?: () => void;
  onInstrumentMeta?: (meta: {
    market: "INDIA" | "GLOBAL" | "INDEX";
    currency?: string;
    exchange?: string;
    provider?: string;
  }) => void;
  mobileOpen?: boolean;
  onClose?: () => void;
};

type WatchItem = { name: string };

type LiveQuote = {
  price: number;
  changePct: number;
};

type InstrumentSearchResult = {
  symbol: string;
  name: string;
  short_name?: string | null;
  exchange: string;
  country?: string;
  currency?: string;
  asset_type: string;
  provider: "upstox" | "yfinance";
  provider_symbol: string;
  instrument_key?: string | null;
  segment?: string | null;
};

const watchlist: WatchItem[] = [
  { name: "RELIANCE" },
  { name: "TCS" },
  { name: "HDFCBANK" },
  { name: "INFY" },
  { name: "NIFTY 50" },
  { name: "BANKNIFTY" },
];

const groups = [
  { title: "TREND", items: ["EMA 20", "EMA 50", "EMA 200", "VWAP", "Supertrend"] },
  { title: "MOMENTUM", items: ["RSI", "MACD", "Stochastic"] },
  { title: "VOLATILITY", items: ["ATR", "Bollinger Bands"] },
  { title: "VOLUME", items: ["Volume", "OBV", "MFI"] },
];

const timeframeOptions = ["1D", "1W", "1M", "1Y", "ALL"];

const THEME_STORAGE_KEY = "wowmazing-sidebar-theme";

type Theme = "dark" | "light";

function formatPrice(price: number): string {
  return price.toLocaleString("en-IN", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });
}

function formatChangePct(changePct: number): string {
  return `${changePct >= 0 ? "+" : ""}${changePct.toFixed(2)}%`;
}

function getQuoteTone(changePct: number): "gain" | "loss" | "flat" {
  if (changePct > 0) return "gain";
  if (changePct < 0) return "loss";
  return "flat";
}

export default function Sidebar({
  symbol,
  setSymbol,
  indicators,
  toggleIndicator,
  onOpenLearningCenter,
  onInstrumentMeta,
  mobileOpen = false,
  onClose,
}: SidebarProps) {
  const [liveQuotes, setLiveQuotes] = useState<Record<string, LiveQuote>>({});
  const [searchSymbol, setSearchSymbol] = useState("");
  const [searchMarket, setSearchMarket] = useState("ALL");
  const [searchLoading, setSearchLoading] = useState(false);
  const [searchError, setSearchError] = useState("");
  const [searchResults, setSearchResults] = useState<InstrumentSearchResult[]>([]);
  const [theme, setTheme] = useState<Theme>(() => {
    if (typeof window === "undefined") return "dark";
    return window.localStorage.getItem(THEME_STORAGE_KEY) === "light"
      ? "light"
      : "dark";
  });
  const [activeTimeframe, setActiveTimeframe] = useState("1D");
  const [watchlistOpen, setWatchlistOpen] = useState(true);
  const [indicatorsOpen, setIndicatorsOpen] = useState(true);

  useEffect(() => {
    document.documentElement.dataset.wowmazingTheme = theme;
    window.localStorage.setItem(THEME_STORAGE_KEY, theme);
  }, [theme]);

  const enabledIndicatorCount = useMemo(
    () => Object.values(indicators).filter(Boolean).length,
    [indicators],
  );

  const searchInstruments = async () => {
    setSearchError("");
    setSearchResults([]);

    const value = searchSymbol.trim();
    if (!value) {
      setSearchError("Enter a company name or symbol first.");
      return;
    }

    setSearchLoading(true);

    try {
      const response = await fetch(
        `${API_BASE_URL}/instrument/search?q=${encodeURIComponent(value)}&market=${encodeURIComponent(searchMarket)}`,
      );

      if (!response.ok) {
        throw new Error(`Search failed (HTTP ${response.status}).`);
      }

      const data = (await response.json()) as {
        success: boolean;
        results?: InstrumentSearchResult[];
      };

      const results = data.results ?? [];
      if (!results.length) {
        throw new Error(`No supported instrument found for "${value}".`);
      }

      setSearchResults(results);
    } catch (error) {
      setSearchResults([]);
      setSearchError(
        error instanceof Error ? error.message : "Could not search instruments.",
      );
    } finally {
      setSearchLoading(false);
    }
  };

  const selectSearchResult = (result: InstrumentSearchResult) => {
    const isGlobal = result.provider === "yfinance";
    const isIndex =
      (result.segment || "").toUpperCase().includes("INDEX") ||
      (result.exchange || "").toUpperCase().includes("INDEX") ||
      result.asset_type.toLowerCase() === "index";

    setSymbol(result.provider_symbol);
    onInstrumentMeta?.({
      market: isGlobal ? "GLOBAL" : isIndex ? "INDEX" : "INDIA",
      currency: result.currency || undefined,
      exchange: result.exchange || undefined,
      provider: result.provider,
    });
    setSearchResults([]);
    setSearchSymbol("");
    setSearchError("");
    onClose?.();
  };

  useEffect(() => {
    let cancelled = false;

    const loadWatchlist = async () => {
      try {
        const response = await fetch(`${API_BASE_URL}/watchlist`);
        if (!response.ok) {
          throw new Error(`Watchlist request failed with HTTP ${response.status}.`);
        }

        const data = (await response.json()) as {
          quotes?: Record<string, { price?: number; change_pct?: number }>;
        };

        if (cancelled) return;

        const nextQuotes: Record<string, LiveQuote> = {};
        for (const [name, quote] of Object.entries(data.quotes ?? {})) {
          if (typeof quote.price === "number" && typeof quote.change_pct === "number") {
            nextQuotes[name] = {
              price: quote.price,
              changePct: quote.change_pct,
            };
          }
        }
        setLiveQuotes(nextQuotes);
      } catch {
        // Keep the last known quote state when the request fails.
      }
    };

    void loadWatchlist();
    const intervalId = window.setInterval(() => void loadWatchlist(), 30000);

    return () => {
      cancelled = true;
      window.clearInterval(intervalId);
    };
  }, []);

  const activeInstrument = liveQuotes[symbol] ?? liveQuotes[symbol === "NIFTY 50" ? "NIFTY 50" : symbol];

  return (
    <aside
      className={`sidebar modern-fintech-sidebar ${mobileOpen ? "mobile-open" : ""}`}
      data-theme={theme}
    >
      <style>{`
        .modern-fintech-sidebar {
          --wm-bg: #0f172a;
          --wm-surface: rgba(30, 41, 59, .68);
          --wm-surface-2: rgba(51, 65, 85, .44);
          --wm-border: rgba(148, 163, 184, .16);
          --wm-border-strong: rgba(148, 163, 184, .25);
          --wm-text: #e2e8f0;
          --wm-muted: #94a3b8;
          --wm-subtle: #64748b;
          --wm-green: #6ee7b7;
          --wm-red: #fda4af;
          --wm-shadow: 0 18px 40px rgba(2, 6, 23, .18);
          color: var(--wm-text);
          background:
            radial-gradient(circle at 10% 0%, rgba(71, 85, 105, .16), transparent 38%),
            var(--wm-bg);
          border-right: 1px solid var(--wm-border);
          transition: background .25s ease, color .25s ease, border-color .25s ease;
        }
        .modern-fintech-sidebar[data-theme="light"] {
          --wm-bg: #f8fafc;
          --wm-surface: rgba(255,255,255,.88);
          --wm-surface-2: rgba(241,245,249,.92);
          --wm-border: rgba(71,85,105,.14);
          --wm-border-strong: rgba(71,85,105,.22);
          --wm-text: #0f172a;
          --wm-muted: #64748b;
          --wm-subtle: #94a3b8;
          --wm-shadow: 0 18px 40px rgba(15,23,42,.08);
        }
        .modern-fintech-sidebar * { box-sizing: border-box; }
        .modern-fintech-sidebar .wm-topbar {
          display:flex; align-items:center; justify-content:space-between; gap:12px;
          padding:16px 16px 14px; border-bottom:1px solid var(--wm-border);
        }
        .modern-fintech-sidebar .wm-brand { display:flex; gap:10px; align-items:center; min-width:0; }
        .modern-fintech-sidebar .wm-logo {
          width:36px; height:36px; border:1px solid var(--wm-border-strong); border-radius:12px;
          display:grid; place-items:center; font-weight:800; letter-spacing:-.04em;
          background:var(--wm-surface); box-shadow:var(--wm-shadow);
        }
        .modern-fintech-sidebar .wm-brand-main { font-size:13px; font-weight:800; letter-spacing:.08em; }
        .modern-fintech-sidebar .wm-brand-sub { margin-top:2px; font-size:10px; color:var(--wm-muted); letter-spacing:.12em; }
        .modern-fintech-sidebar .wm-icon-btn {
          width:34px; height:34px; border-radius:10px; border:1px solid var(--wm-border);
          display:grid; place-items:center; background:transparent; color:var(--wm-muted); cursor:pointer;
          transition:transform .2s ease, background .2s ease, color .2s ease, border-color .2s ease;
        }
        .modern-fintech-sidebar .wm-icon-btn:hover { transform:translateY(-1px); background:var(--wm-surface); color:var(--wm-text); border-color:var(--wm-border-strong); }
        .modern-fintech-sidebar .wm-section { margin:12px; padding:12px; border:1px solid var(--wm-border); background:var(--wm-surface); border-radius:16px; box-shadow:0 8px 26px rgba(2,6,23,.06); }
        .modern-fintech-sidebar .wm-section-head { display:flex; align-items:center; justify-content:space-between; gap:8px; margin-bottom:10px; }
        .modern-fintech-sidebar .wm-section-label { font-size:10px; font-weight:800; letter-spacing:.12em; color:var(--wm-muted); }
        .modern-fintech-sidebar .wm-section-toggle { display:flex; align-items:center; gap:5px; border:0; background:transparent; color:var(--wm-muted); cursor:pointer; padding:0; }
        .modern-fintech-sidebar .wm-nav-grid { display:grid; gap:6px; }
        .modern-fintech-sidebar .wm-nav {
          display:flex; align-items:center; gap:10px; width:100%; padding:10px 11px; border-radius:11px;
          border:1px solid transparent; background:transparent; color:var(--wm-muted); cursor:pointer; text-align:left;
          transition:background .2s ease, border-color .2s ease, color .2s ease, transform .2s ease;
        }
        .modern-fintech-sidebar .wm-nav:hover { background:var(--wm-surface-2); color:var(--wm-text); transform:translateX(1px); }
        .modern-fintech-sidebar .wm-nav.active { background:var(--wm-surface-2); color:var(--wm-text); border-color:var(--wm-border); }
        .modern-fintech-sidebar .wm-search-row { display:flex; gap:7px; }
        .modern-fintech-sidebar .wm-search-box { position:relative; flex:1; }
        .modern-fintech-sidebar .wm-search-input {
          width:100%; padding:10px 10px 10px 33px; border-radius:11px; border:1px solid var(--wm-border);
          background:var(--wm-surface-2); color:var(--wm-text); outline:none;
          transition:border-color .2s ease, box-shadow .2s ease;
        }
        .modern-fintech-sidebar .wm-search-input:focus { border-color:var(--wm-border-strong); box-shadow:0 0 0 3px rgba(148,163,184,.08); }
        .modern-fintech-sidebar .wm-search-icon { position:absolute; left:10px; top:50%; transform:translateY(-50%); color:var(--wm-muted); pointer-events:none; }
        .modern-fintech-sidebar .wm-search-submit { padding:0 12px; border-radius:11px; border:1px solid var(--wm-border); background:var(--wm-text); color:var(--wm-bg); font-weight:700; cursor:pointer; }
        .modern-fintech-sidebar .wm-search-submit:disabled { opacity:.55; cursor:not-allowed; }
        .modern-fintech-sidebar .wm-market-select { width:100%; margin-top:8px; padding:9px 10px; border:1px solid var(--wm-border); border-radius:10px; background:var(--wm-surface-2); color:var(--wm-text); }
        .modern-fintech-sidebar .wm-hint { display:block; margin-top:7px; color:var(--wm-subtle); font-size:10px; line-height:1.5; }
        .modern-fintech-sidebar .wm-results { display:grid; gap:6px; margin-top:9px; }
        .modern-fintech-sidebar .wm-result { border:1px solid var(--wm-border); border-radius:11px; background:var(--wm-surface-2); padding:9px; color:var(--wm-text); cursor:pointer; text-align:left; transition:transform .2s ease, border-color .2s ease; }
        .modern-fintech-sidebar .wm-result:hover { transform:translateY(-1px); border-color:var(--wm-border-strong); }
        .modern-fintech-sidebar .wm-result-main { display:flex; justify-content:space-between; gap:8px; }
        .modern-fintech-sidebar .wm-result-main strong { font-size:12px; }
        .modern-fintech-sidebar .wm-result-main span { max-width:140px; overflow:hidden; text-overflow:ellipsis; white-space:nowrap; color:var(--wm-muted); font-size:10px; }
        .modern-fintech-sidebar .wm-result-meta { display:flex; gap:6px; margin-top:6px; color:var(--wm-subtle); font-size:9px; }
        .modern-fintech-sidebar .wm-error { margin-top:8px; color:var(--wm-red); font-size:10px; }
        .modern-fintech-sidebar .wm-watchlist { display:grid; gap:6px; }
        .modern-fintech-sidebar .wm-watch {
          width:100%; display:flex; align-items:center; justify-content:space-between; gap:10px;
          padding:10px; border:1px solid var(--wm-border); border-radius:12px; background:transparent; color:var(--wm-text); cursor:pointer; text-align:left;
          transition:transform .2s ease, background .2s ease, border-color .2s ease;
        }
        .modern-fintech-sidebar .wm-watch:hover { transform:translateY(-1px); background:var(--wm-surface-2); border-color:var(--wm-border-strong); }
        .modern-fintech-sidebar .wm-watch.active { background:var(--wm-surface-2); border-color:var(--wm-border-strong); }
        .modern-fintech-sidebar .wm-watch-title { font-size:11px; font-weight:800; }
        .modern-fintech-sidebar .wm-watch-sub { margin-top:3px; color:var(--wm-muted); font-size:9px; }
        .modern-fintech-sidebar .wm-watch-right { display:flex; flex-direction:column; align-items:flex-end; gap:3px; }
        .modern-fintech-sidebar .wm-watch-price { font-size:11px; font-weight:800; }
        .modern-fintech-sidebar .wm-watch-change { font-size:10px; }
        .modern-fintech-sidebar .gain { color:var(--wm-green); }
        .modern-fintech-sidebar .loss { color:var(--wm-red); }
        .modern-fintech-sidebar .flat { color:var(--wm-muted); }
        .modern-fintech-sidebar .wm-pills { display:flex; gap:5px; flex-wrap:wrap; }
        .modern-fintech-sidebar .wm-pill {
          padding:7px 10px; border-radius:999px; border:1px solid var(--wm-border); background:transparent; color:var(--wm-muted); cursor:pointer;
          font-size:10px; font-weight:800; transition:background .2s ease, color .2s ease, border-color .2s ease, transform .2s ease;
        }
        .modern-fintech-sidebar .wm-pill:hover { transform:translateY(-1px); color:var(--wm-text); }
        .modern-fintech-sidebar .wm-pill.active { background:var(--wm-text); color:var(--wm-bg); border-color:var(--wm-text); }
        .modern-fintech-sidebar .wm-indicator-group { padding:8px 0; border-top:1px solid var(--wm-border); }
        .modern-fintech-sidebar .wm-indicator-group:first-child { border-top:0; padding-top:0; }
        .modern-fintech-sidebar .wm-indicator-title { margin-bottom:6px; color:var(--wm-subtle); font-size:9px; font-weight:800; letter-spacing:.11em; }
        .modern-fintech-sidebar .wm-indicator-row { width:100%; display:flex; align-items:center; gap:8px; padding:6px 0; border:0; background:transparent; color:var(--wm-muted); cursor:pointer; font-size:10px; text-align:left; }
        .modern-fintech-sidebar .wm-check { width:18px; height:18px; border-radius:6px; border:1px solid var(--wm-border-strong); display:grid; place-items:center; font-size:10px; }
        .modern-fintech-sidebar .wm-check.checked { background:var(--wm-text); color:var(--wm-bg); border-color:var(--wm-text); }
        .modern-fintech-sidebar .wm-risk-grid { display:grid; grid-template-columns:1fr 1fr; gap:7px; }
        .modern-fintech-sidebar .wm-risk-card { padding:10px; border:1px solid var(--wm-border); border-radius:12px; background:var(--wm-surface-2); }
        .modern-fintech-sidebar .wm-risk-card span { display:block; color:var(--wm-muted); font-size:9px; }
        .modern-fintech-sidebar .wm-risk-card strong { display:block; margin-top:3px; font-size:12px; }
        .modern-fintech-sidebar .wm-engine { display:flex; align-items:center; justify-content:space-between; padding:11px 12px; margin:12px; border:1px solid var(--wm-border); border-radius:14px; background:var(--wm-surface); }
        .modern-fintech-sidebar .wm-engine-left { display:flex; align-items:center; gap:8px; color:var(--wm-muted); font-size:10px; font-weight:700; }
        .modern-fintech-sidebar .wm-dot { width:7px; height:7px; border-radius:50%; background:var(--wm-green); box-shadow:0 0 0 4px rgba(110,231,183,.10); }
        .modern-fintech-sidebar .wm-timeframe-wrap { margin-top:10px; }
        .modern-fintech-sidebar .wm-active-quote { margin:10px 0 0; padding:10px; border:1px solid var(--wm-border); border-radius:12px; background:var(--wm-surface-2); }
        .modern-fintech-sidebar .wm-active-quote-label { font-size:9px; color:var(--wm-muted); }
        .modern-fintech-sidebar .wm-active-quote-main { display:flex; align-items:baseline; justify-content:space-between; gap:10px; margin-top:4px; }
        .modern-fintech-sidebar .wm-active-quote-symbol { font-size:12px; font-weight:800; }
        .modern-fintech-sidebar .wm-active-quote-price { font-size:12px; font-weight:800; }
        .modern-fintech-sidebar .wm-close { margin-left:auto; }
        @media (max-width: 1100px) {
          .modern-fintech-sidebar { box-shadow: 18px 0 42px rgba(2,6,23,.2); }
        }
      `}</style>

      <div className="wm-topbar">
        <div className="wm-brand">
          <div className="wm-logo">W</div>
          <div>
            <div className="wm-brand-main">WOWMAZING</div>
            <div className="wm-brand-sub">MARKET AGENT</div>
          </div>
        </div>

        <div style={{ display: "flex", gap: 6 }}>
          <button
            type="button"
            className="wm-icon-btn"
            aria-label="Toggle theme"
            onClick={() => setTheme((current) => current === "dark" ? "light" : "dark")}
          >
            {theme === "dark" ? <Sun size={16} /> : <Moon size={16} />}
          </button>

          <button
            type="button"
            className="wm-icon-btn wm-close"
            aria-label="Close navigation"
            onClick={() => onClose?.()}
          >
            <X size={16} />
          </button>
        </div>
      </div>

      <div className="wm-section">
        <div className="wm-section-head">
          <span className="wm-section-label">WORKSPACE</span>
        </div>
        <div className="wm-nav-grid">
          <button className="wm-nav active"><BarChart3 size={15} />Market Terminal</button>
          <button className="wm-nav"><Activity size={15} />Market Scanner</button>
          <button className="wm-nav"><LineChart size={15} />Backtesting Lab</button>
          <button className="wm-nav"><BriefcaseBusiness size={15} />Paper Trading</button>
          <button
            type="button"
            className="wm-nav"
            onClick={() => {
              onOpenLearningCenter?.();
              onClose?.();
            }}
          >
            <BookOpen size={15} />How to Use
          </button>
        </div>
      </div>

      <div className="wm-section">
        <div className="wm-section-head">
          <span className="wm-section-label">SEARCH INSTRUMENT</span>
          <Search size={14} />
        </div>

        <form
          onSubmit={(event) => {
            event.preventDefault();
            void searchInstruments();
          }}
        >
          <div className="wm-search-row">
            <div className="wm-search-box">
              <Search size={14} className="wm-search-icon" />
              <input
                className="wm-search-input"
                value={searchSymbol}
                onChange={(event) => {
                  setSearchSymbol(event.target.value);
                  setSearchError("");
                }}
                placeholder="Company or ticker..."
                aria-label="Search stock or index"
                autoComplete="off"
                spellCheck={false}
                disabled={searchLoading}
              />
            </div>
            <button
              type="submit"
              className="wm-search-submit"
              disabled={searchLoading || !searchSymbol.trim()}
            >
              {searchLoading ? "…" : "Search"}
            </button>
          </div>
        </form>

        <select
          className="wm-market-select"
          value={searchMarket}
          onChange={(event) => {
            setSearchMarket(event.target.value);
            setSearchResults([]);
            setSearchError("");
          }}
          aria-label="Market filter"
          disabled={searchLoading}
        >
          <option value="ALL">All Markets</option>
          <option value="INDIA">India · NSE + BSE</option>
          <option value="NSE">NSE</option>
          <option value="BSE">BSE</option>
          <option value="GLOBAL">Global · Yahoo Finance</option>
        </select>

        <span className="wm-hint">
          Search by company name or ticker. Choose the exact exchange.
        </span>

        {searchResults.length > 0 && (
          <div className="wm-results">
            {searchResults.map((result, index) => (
              <button
                type="button"
                className="wm-result"
                key={`${result.provider}-${result.provider_symbol}-${result.exchange}-${index}`}
                onClick={() => selectSearchResult(result)}
              >
                <div className="wm-result-main">
                  <strong>{result.symbol}</strong>
                  <span>{result.name}</span>
                </div>
                <div className="wm-result-meta">
                  <span>{result.exchange || "Market"}</span>
                  <span>{result.currency || ""}</span>
                  <span>{result.provider === "upstox" ? "UPSTOX" : "YF"}</span>
                </div>
              </button>
            ))}
          </div>
        )}

        {searchError && <div className="wm-error">{searchError}</div>}
      </div>

      <div className="wm-section">
        <div className="wm-section-head">
          <button
            type="button"
            className="wm-section-toggle"
            onClick={() => setWatchlistOpen((current) => !current)}
          >
            {watchlistOpen ? <ChevronDown size={14} /> : <ChevronRight size={14} />}
            <span className="wm-section-label">WATCHLIST</span>
          </button>
          <Bell size={14} />
        </div>

        {watchlistOpen && (
          <div className="wm-watchlist">
            {watchlist.map((item) => {
              const cleanName = item.name;
              const isIndex = item.name === "NIFTY 50" || item.name === "BANKNIFTY";
              const quote = liveQuotes[item.name];
              const tone = quote ? getQuoteTone(quote.changePct) : "flat";

              return (
                <button
                  key={item.name}
                  type="button"
                  className={`wm-watch ${symbol === cleanName ? "active" : ""}`}
                  onClick={() => {
                    setSymbol(cleanName);
                    onInstrumentMeta?.({
                      market: isIndex ? "INDEX" : "INDIA",
                      currency: "INR",
                      exchange: isIndex ? "INDEX" : "NSE",
                      provider: "upstox",
                    });
                    onClose?.();
                  }}
                >
                  <div>
                    <div className="wm-watch-title">{item.name}</div>
                    <div className="wm-watch-sub">{isIndex ? "INDEX" : "NSE"}</div>
                  </div>
                  <div className="wm-watch-right">
                    <div className="wm-watch-price">
                      {quote ? `₹${formatPrice(quote.price)}` : "—"}
                    </div>
                    <div className={`wm-watch-change ${tone}`}>
                      {quote ? formatChangePct(quote.changePct) : "—"}
                    </div>
                  </div>
                </button>
              );
            })}
          </div>
        )}

        <div className="wm-timeframe-wrap">
          <div className="wm-section-label" style={{ marginBottom: 7 }}>TIMEFRAME</div>
          <div className="wm-pills">
            {timeframeOptions.map((option) => (
              <button
                key={option}
                type="button"
                className={`wm-pill ${activeTimeframe === option ? "active" : ""}`}
                onClick={() => setActiveTimeframe(option)}
              >
                {option}
              </button>
            ))}
          </div>
        </div>

        {activeInstrument && (
          <div className="wm-active-quote">
            <div className="wm-active-quote-label">SELECTED INSTRUMENT</div>
            <div className="wm-active-quote-main">
              <span className="wm-active-quote-symbol">{symbol}</span>
              <span className={`wm-active-quote-price ${getQuoteTone(activeInstrument.changePct)}`}>
                ₹{formatPrice(activeInstrument.price)} {formatChangePct(activeInstrument.changePct)}
              </span>
            </div>
          </div>
        )}
      </div>

      <div className="wm-section">
        <div className="wm-section-head">
          <button
            type="button"
            className="wm-section-toggle"
            onClick={() => setIndicatorsOpen((current) => !current)}
          >
            {indicatorsOpen ? <ChevronDown size={14} /> : <ChevronRight size={14} />}
            <span className="wm-section-label">INDICATORS</span>
          </button>
          <span className="wm-section-label">{enabledIndicatorCount}</span>
        </div>

        {indicatorsOpen && groups.map((group) => (
          <div className="wm-indicator-group" key={group.title}>
            <div className="wm-indicator-title">{group.title}</div>
            {group.items.map((name) => {
              const enabled = Boolean(indicators[name]);
              return (
                <button
                  type="button"
                  key={name}
                  className="wm-indicator-row"
                  onClick={() => toggleIndicator(name)}
                >
                  <span className={`wm-check ${enabled ? "checked" : ""}`}>
                    {enabled ? "✓" : ""}
                  </span>
                  <span>{name}</span>
                </button>
              );
            })}
          </div>
        ))}
      </div>

      <div className="wm-section">
        <div className="wm-section-head">
          <span className="wm-section-label">RISK ENGINE</span>
          <ShieldCheck size={14} />
        </div>
        <div className="wm-risk-grid">
          <div className="wm-risk-card"><span>Trading Capital</span><strong>₹1,00,000</strong></div>
          <div className="wm-risk-card"><span>Risk / Trade</span><strong>1.00%</strong></div>
          <div className="wm-risk-card"><span>Max Risk</span><strong>₹1,000</strong></div>
          <div className="wm-risk-card"><span>Mode</span><strong>Descriptive</strong></div>
        </div>
      </div>

      <div className="wm-engine">
        <div className="wm-engine-left">
          <span className="wm-dot" />
          Quant engine ready
        </div>
        <div style={{ display: "flex", gap: 8, color: "var(--wm-muted)" }}>
          <Wallet size={14} />
          <Gauge size={14} />
          <Settings2 size={14} />
        </div>
      </div>
    </aside>
  );
}
