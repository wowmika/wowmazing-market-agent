import {
  Activity,
  BookOpen,
  BarChart3,
  Bell,
  BriefcaseBusiness,
  Gauge,
  LineChart,
  Search,
  Settings2,
  ShieldCheck,
  Wallet,
  X,
} from "lucide-react";
import { useEffect, useState } from "react";

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

type WatchItem = {
  name: string;
};

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

const API_BASE = "http://127.0.0.1:8000";

function formatPrice(price: number): string {
  return price.toLocaleString("en-IN", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });
}

function formatChangePct(changePct: number): string {
  return `${changePct >= 0 ? "+" : ""}${changePct.toFixed(2)}%`;
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
  const [searchResults, setSearchResults] = useState<
    InstrumentSearchResult[]
  >([]);

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
        `${API_BASE}/instrument/search?q=${encodeURIComponent(
          value,
        )}&market=${encodeURIComponent(searchMarket)}`,
      );

      if (!response.ok) {
        throw new Error(
          `Search failed (HTTP ${response.status}).`,
        );
      }

      const data = (await response.json()) as {
        success: boolean;
        results?: InstrumentSearchResult[];
      };

      const results = data.results ?? [];

      if (!results.length) {
        throw new Error(
          `No supported instrument found for "${value}".`,
        );
      }

      setSearchResults(results);
    } catch (error) {
      setSearchResults([]);
      setSearchError(
        error instanceof Error
          ? error.message
          : "Could not search instruments.",
      );
    } finally {
      setSearchLoading(false);
    }
  };

  const selectSearchResult = (
    result: InstrumentSearchResult,
  ) => {
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
        const response = await fetch(`${API_BASE}/watchlist`);

        if (!response.ok) {
          throw new Error(`Watchlist request failed with HTTP ${response.status}.`);
        }

        const data = (await response.json()) as {
          quotes?: Record<string, { price?: number; change_pct?: number }>;
        };

        if (cancelled) {
          return;
        }

        const nextQuotes: Record<string, LiveQuote> = {};

        for (const [name, quote] of Object.entries(data.quotes ?? {})) {
          if (
            typeof quote.price === "number" &&
            typeof quote.change_pct === "number"
          ) {
            nextQuotes[name] = {
              price: quote.price,
              changePct: quote.change_pct,
            };
          }
        }

        setLiveQuotes(nextQuotes);
      } catch {
        // Keep the last known live values or fall back to the static values.
      }
    };

    void loadWatchlist();

    const intervalId = window.setInterval(() => {
      void loadWatchlist();
    }, 30000);

    return () => {
      cancelled = true;
      window.clearInterval(intervalId);
    };
  }, []);

  return (
    <aside
      className={
        mobileOpen
          ? "sidebar mobile-open"
          : "sidebar"
      }
    >
      <div className="brand">
        <div className="brand-logo">W</div>
        <div>
          <div className="brand-name">WOWMAZING</div>
          <div className="brand-sub">MARKET AGENT</div>
        </div>

        <button
          type="button"
          className="mobile-sidebar-close"
          aria-label="Close navigation"
          onClick={() => onClose?.()}
        >
          <X size={18} />
        </button>
      </div>

      <div className="sidebar-section">
        <div className="section-label">WORKSPACE</div>
        <button className="side-nav active"><BarChart3 size={16} />Market Terminal</button>
        <button className="side-nav"><Activity size={16} />Market Scanner</button>
        <button className="side-nav"><LineChart size={16} />Backtesting Lab</button>
        <button className="side-nav"><BriefcaseBusiness size={16} />Paper Trading</button>
        <button
          type="button"
          className="side-nav"
          onClick={() => {
            onOpenLearningCenter?.();
            onClose?.();
          }}
        >
          <BookOpen size={16} />
          How to Use
        </button>
      </div>

      <div className="sidebar-section symbol-search-section">
        <div className="section-title-row">
          <span className="section-label">SEARCH INSTRUMENT</span>
          <Search size={14} />
        </div>

        <form
          className="symbol-search"
          onSubmit={(event) => {
            event.preventDefault();
            void searchInstruments();
          }}
        >
          <Search size={15} className="symbol-search-icon" />

          <input
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

          <button
            type="submit"
            disabled={searchLoading || !searchSymbol.trim()}
            aria-label="Search instrument"
          >
            {searchLoading ? (
              <span className="symbol-search-spinner" />
            ) : (
              "Search"
            )}
          </button>
        </form>

        <select
          className="symbol-market-select"
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

        <span className="symbol-search-hint">
          Search by company name or ticker. Choose the exact exchange.
        </span>

        {searchResults.length > 0 && (
          <div className="symbol-search-results">
            {searchResults.map((result, index) => (
              <button
                type="button"
                className="symbol-search-result"
                key={`${result.provider}-${result.provider_symbol}-${result.exchange}-${index}`}
                onClick={() => selectSearchResult(result)}
              >
                <div className="symbol-search-result-main">
                  <strong>
                    {result.symbol}
                  </strong>
                  <span>
                    {result.name}
                  </span>
                </div>

                <div className="symbol-search-result-meta">
                  <span>
                    {result.exchange || "Market"}
                  </span>
                  <span>
                    {result.currency || ""}
                  </span>
                  <span>
                    {result.provider === "upstox"
                      ? "UPSTOX"
                      : "YF"}
                  </span>
                </div>
              </button>
            ))}
          </div>
        )}

        {searchError && (
          <div className="symbol-search-error">
            {searchError}
          </div>
        )}
      </div>

      <div className="sidebar-section">
        <div className="section-title-row"><span className="section-label">WATCHLIST</span><Bell size={14} /></div>
        <div className="watchlist">
          {watchlist.map((item) => {
            const cleanName = item.name === "NIFTY 50" ? "^NSEI" : item.name;
            const active = symbol === cleanName;
            const liveQuote = liveQuotes[item.name];

            const displayPrice = liveQuote
              ? `₹${formatPrice(liveQuote.price)}`
              : "—";
            const displayChange = liveQuote
              ? formatChangePct(liveQuote.changePct)
              : "—";
            const isPositive = liveQuote
              ? liveQuote.changePct >= 0
              : false;

            return (
              <button
                key={item.name}
                className={active ? "watch-item active" : "watch-item"}
                onClick={() => {
                  setSymbol(cleanName);
                  onInstrumentMeta?.({
                    market:
                      cleanName === "NIFTY 50" || cleanName === "BANKNIFTY"
                        ? "INDEX"
                        : "INDIA",
                    currency: "INR",
                    exchange:
                      cleanName === "NIFTY 50" || cleanName === "BANKNIFTY"
                        ? "INDEX"
                        : "NSE",
                    provider: "upstox",
                  });
                  onClose?.();
                }}
              >
                <div><strong>{item.name}</strong><span>NSE</span></div>
                <div className="watch-price">
                  <strong>{displayPrice}</strong>
                  <span className={isPositive ? "positive" : "negative"}>{displayChange}</span>
                </div>
              </button>
            );
          })}
        </div>

        {!watchlist.some(
          (item) =>
            (item.name === "NIFTY 50"
              ? "^NSEI"
              : item.name) === symbol,
        ) && (
          <button
            type="button"
            className="watch-item active custom-symbol-item"
            onClick={() => onClose?.()}
          >
            <div>
              <strong>{symbol}</strong>
              <span>SELECTED</span>
            </div>

            <div className="watch-price">
              <strong>LIVE</strong>
            </div>
          </button>
        )}
      </div>

      <div className="sidebar-section">
        <div className="section-title-row"><span className="section-label">STRATEGY</span><Settings2 size={14} /></div>
        <button className="strategy-select"><span>Intraday</span><span>15m / 1h</span></button>
      </div>

      <div className="sidebar-section indicators">
        <div className="section-title-row"><span className="section-label">INDICATORS</span><span className="indicator-count">{Object.values(indicators).filter(Boolean).length}</span></div>
        {groups.map((group) => (
          <div className="indicator-group" key={group.title}>
            <div className="indicator-group-title">{group.title}</div>
            {group.items.map((name) => {
              const enabled = indicators[name];
              return <button key={name} className="indicator-row" onClick={() => toggleIndicator(name)}><span className={enabled ? "check checked" : "check"}>{enabled ? "✓" : ""}</span><span>{name}</span></button>;
            })}
          </div>
        ))}
      </div>

      <div className="sidebar-risk">
        <div className="risk-header"><ShieldCheck size={15} />RISK ENGINE</div>
        <div className="risk-stat"><span>Trading Capital</span><strong>₹1,00,000</strong></div>
        <div className="risk-stat"><span>Risk / Trade</span><strong>1.00%</strong></div>
        <div className="risk-stat"><span>Max Risk</span><strong>₹1,000</strong></div>
      </div>

      <div className="sidebar-footer">
        <div className="engine-status"><span className="status-dot" />Quant engine ready</div>
        <div className="footer-icons"><Wallet size={14} /><Gauge size={14} /></div>
      </div>
    </aside>
  );
}
