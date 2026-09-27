import { BookOpen, Search, X } from "lucide-react";
import { useMemo, useState } from "react";
import "./learning-center.css";

type LearningItem = {
  term: string;
  plain: string;
  use: string;
  watch?: string;
};

type LearningSection = {
  title: string;
  subtitle: string;
  items: LearningItem[];
};

const sections: LearningSection[] = [
  {
    title: "Start Here",
    subtitle: "The simplest way to use WOWMAZING Market Agent.",
    items: [
      {
        term: "Instrument",
        plain: "The stock, index, or other market item you are looking at. Example: RELIANCE, AAPL, or NIFTY 50.",
        use: "Search for the exact company or ticker and choose the correct exchange when there is more than one result.",
      },
      {
        term: "Timeframe",
        plain: "How much time one candle represents. A 15m candle covers 15 minutes; a 1H candle covers one hour.",
        use: "Use a shorter timeframe for more detailed movement and a longer timeframe to see the bigger trend.",
      },
      {
        term: "Primary timeframe",
        plain: "The main timeframe used to study your setup.",
        use: "Keep your strategy rules tied to one main timeframe so you do not mix signals from completely different views.",
      },
      {
        term: "Confirmation",
        plain: "Extra evidence from another timeframe or condition that supports the main setup.",
        use: "Treat confirmation as supporting evidence, not a guarantee that a trade will work.",
      },
      {
        term: "Market Bias",
        plain: "A simple description of the current market direction: bullish, bearish, or unclear.",
        use: "Use it to understand the current environment before looking at a strategy setup.",
      },
      {
        term: "Signal",
        plain: "The engine's current rule-based output, such as BUY, SELL, or WAIT.",
        use: "Use it as a summary of the rules currently being checked. It is not a guarantee of the next price move.",
      },
    ],
  },
  {
    title: "Chart Indicators",
    subtitle: "What the technical words mean in plain English.",
    items: [
      {
        term: "EMA 20 / EMA 50 / EMA 200",
        plain: "Moving averages that smooth price data. The number tells you how many candles are being averaged, with more weight given to recent prices.",
        use: "Compare price and different EMAs to see whether the shorter-term trend is above or below the longer-term trend.",
      },
      {
        term: "VWAP",
        plain: "Volume Weighted Average Price. It estimates the average price traded during the session, giving more importance to prices where more volume traded.",
        use: "A price above VWAP can show stronger buying conditions; below VWAP can show weaker conditions. Use it with the rest of your rules.",
      },
      {
        term: "RSI",
        plain: "Relative Strength Index. A momentum gauge that usually moves from 0 to 100.",
        use: "Use RSI to judge momentum and whether recent price movement is relatively strong or weak. Avoid treating one RSI number as an automatic buy or sell.",
      },
      {
        term: "MACD",
        plain: "A momentum and trend indicator built from moving averages.",
        use: "Look at the MACD line, signal line, and direction to understand momentum changes rather than using it alone.",
      },
      {
        term: "ATR",
        plain: "Average True Range. A measure of how much price has been moving recently.",
        use: "A higher ATR means wider typical movement. Strategies can use ATR to make stops and targets adjust to market volatility.",
      },
      {
        term: "Volume Ratio",
        plain: "Recent trading volume compared with a reference level of typical volume.",
        use: "A ratio above 1 means more volume than the reference level; below 1 means less.",
      },
      {
        term: "Supertrend",
        plain: "A volatility-based trend-following indicator that tries to show whether price is currently in an uptrend or downtrend.",
        use: "Use it as trend context, not as a standalone guarantee.",
      },
      {
        term: "Stochastic",
        plain: "A momentum indicator that compares the current closing price with its recent trading range.",
        use: "It can help identify shifts in short-term momentum, especially when combined with trend context.",
      },
      {
        term: "Bollinger Bands",
        plain: "A moving average surrounded by bands that expand and contract with volatility.",
        use: "Wider bands mean larger recent price movement; narrower bands mean quieter movement.",
      },
      {
        term: "OBV",
        plain: "On-Balance Volume. A running measure that adds or subtracts volume depending on whether price closes up or down.",
        use: "Use it to look for volume moving in the same or opposite direction as price.",
      },
      {
        term: "MFI",
        plain: "Money Flow Index. A volume-aware momentum indicator that estimates buying and selling pressure.",
        use: "Use it as another momentum/flow clue alongside price and volume.",
      },
    ],
  },
  {
    title: "Strategy Evidence",
    subtitle: "The numbers that tell you how a strategy behaved historically.",
    items: [
      {
        term: "Backtest",
        plain: "Running your strategy rules on historical market data to see what would have happened in the past.",
        use: "Use a backtest to measure behavior before paper trading or using real money.",
      },
      {
        term: "Win Rate",
        plain: "The percentage of historical trades that ended as winners in the tested sample.",
        use: "Compare it with the number of trades, losses, payoff size, and drawdown. Historical win rate is not the probability of the next trade winning.",
      },
      {
        term: "Expectancy",
        plain: "The average amount the strategy made or lost per trade over the tested sample.",
        use: "A strategy can have a lower win rate and still have positive expectancy if its winners are much larger than its losers.",
      },
      {
        term: "Profit Factor",
        plain: "Gross profit divided by gross loss over the tested trades.",
        use: "It helps show how total winning money compared with total losing money in that historical test.",
      },
      {
        term: "Max Drawdown",
        plain: "The largest peak-to-trough decline in the historical strategy result.",
        use: "Use it to understand how deep a bad period could become in the tested sample.",
      },
      {
        term: "Max Losing Streak",
        plain: "The largest number of consecutive losing trades in the tested history.",
        use: "This helps you understand how uncomfortable a sequence of losses could be.",
      },
      {
        term: "Out-of-sample (OOS)",
        plain: "Data that was kept separate from the part used to develop or tune the strategy.",
        use: "Use OOS results as a check against overfitting to the development period.",
      },
      {
        term: "Confidence Interval",
        plain: "A range showing how uncertain an estimated statistic is from a finite sample.",
        use: "A wide interval means the sample estimate is less precise. More trades can provide more information, but do not remove market uncertainty.",
      },
      {
        term: "Monte Carlo",
        plain: "A simulation that reshuffles or samples historical trade outcomes many times to explore possible sequences.",
        use: "Use it to understand how different losing and winning sequences could affect drawdown and streaks. It is a simulation, not a forecast.",
      },
      {
        term: "R / R-multiple",
        plain: "A way to express profit or loss relative to the amount you planned to risk on one trade. -1R means losing the planned risk; +2R means making twice that risk.",
        use: "R-multiples make different trades easier to compare even when their rupee or dollar sizes differ.",
      },
      {
        term: "Slippage",
        plain: "The difference between the price you expected and the price you actually get because markets move during execution.",
        use: "Include realistic slippage in backtests so historical results are not unrealistically optimistic.",
      },
      {
        term: "Fees / Costs",
        plain: "Brokerage, exchange costs, taxes, and other trading expenses that reduce results.",
        use: "Make sure your strategy still makes sense after reasonable costs are included.",
      },
    ],
  },
  {
    title: "Risk & Trading",
    subtitle: "The terms that help control how much you put at risk.",
    items: [
      {
        term: "Risk per Trade",
        plain: "The maximum amount you decide you are willing to lose on one trade if the planned stop is hit.",
        use: "Set this before entering a trade. A 1% setting means 1% of the chosen trading capital is the planned risk, not a promise of a 1% loss every time.",
      },
      {
        term: "Stop Loss",
        plain: "A predefined exit level intended to limit the loss if the trade moves against you.",
        use: "Define the invalidation point before entry rather than deciding emotionally after the trade starts moving.",
      },
      {
        term: "Target",
        plain: "A predefined level where you plan to take profit if the trade reaches the intended objective.",
        use: "Compare the target with the planned stop to understand the reward-to-risk relationship.",
      },
      {
        term: "Position Size",
        plain: "How many shares or units you trade.",
        use: "Position size should be connected to your chosen risk and the distance to the stop, rather than being chosen only because a stock looks affordable.",
      },
      {
        term: "Paper Trading",
        plain: "Practising a strategy with simulated trades instead of real money.",
        use: "Use it to check whether your rules are practical in live market conditions before committing capital.",
      },
      {
        term: "Risk Engine",
        plain: "The part of the app that helps translate your risk settings into understandable trade limits.",
        use: "Treat its output as a planning tool and verify every real-world order yourself.",
      },
    ],
  },
];

export default function LearningCenter({ onClose }: { onClose: () => void }) {
  const [query, setQuery] = useState("");
  const [activeSection, setActiveSection] = useState("Start Here");

  const selectedSection = sections.find((section) => section.title === activeSection) ?? sections[0];

  const filteredItems = useMemo(() => {
    const clean = query.trim().toLowerCase();
    if (!clean) return selectedSection.items;

    return selectedSection.items.filter((item) =>
      `${item.term} ${item.plain} ${item.use} ${item.watch ?? ""}`.toLowerCase().includes(clean),
    );
  }, [query, selectedSection]);

  const allResults = useMemo(() => {
    const clean = query.trim().toLowerCase();
    if (!clean) return [] as Array<LearningItem & { section: string }>;

    return sections.flatMap((section) =>
      section.items
        .filter((item) =>
          `${item.term} ${item.plain} ${item.use}`.toLowerCase().includes(clean),
        )
        .map((item) => ({ ...item, section: section.title })),
    );
  }, [query]);

  const showingGlobalSearch = query.trim().length > 0;

  return (
    <div className="learning-overlay" onClick={onClose}>
      <section
        className="learning-center"
        aria-modal="true"
        role="dialog"
        aria-labelledby="learning-title"
        onClick={(event) => event.stopPropagation()}
      >
        <header className="learning-header">
          <div className="learning-header-title">
            <div className="learning-icon"><BookOpen size={20} /></div>
            <div>
              <span className="eyebrow">WOWMAZING GUIDE</span>
              <h2 id="learning-title">How to Use the Market Agent</h2>
              <p>Plain-English explanations for the technical words, numbers, and tools in the terminal.</p>
            </div>
          </div>

          <button type="button" className="learning-close" onClick={onClose} aria-label="Close learning center">
            <X size={19} />
          </button>
        </header>

        <div className="learning-search-row">
          <Search size={17} />
          <input
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder="Search a term, for example RSI, drawdown, VWAP..."
            aria-label="Search learning guide"
          />
        </div>

        {!showingGlobalSearch && (
          <nav className="learning-tabs" aria-label="Learning topics">
            {sections.map((section) => (
              <button
                key={section.title}
                type="button"
                className={activeSection === section.title ? "learning-tab active" : "learning-tab"}
                onClick={() => setActiveSection(section.title)}
              >
                {section.title}
              </button>
            ))}
          </nav>
        )}

        <div className="learning-scroll">
          {showingGlobalSearch ? (
            <>
              <div className="learning-section-intro">
                <span className="eyebrow">SEARCH RESULTS</span>
                <h3>{allResults.length} matching term{allResults.length === 1 ? "" : "s"}</h3>
                <p>Search covers every section of the guide.</p>
              </div>

              <div className="learning-grid">
                {allResults.map((item) => (
                  <article className="learning-card" key={`${item.section}-${item.term}`}>
                    <div className="learning-card-topline">
                      <span className="learning-section-tag">{item.section}</span>
                    </div>
                    <h4>{item.term}</h4>
                    <p><strong>In simple words:</strong> {item.plain}</p>
                    <p><strong>How to use it:</strong> {item.use}</p>
                  </article>
                ))}
              </div>

              {!allResults.length && (
                <div className="learning-empty">
                  No matching term found. Try a simpler word like <strong>RSI</strong>, <strong>risk</strong>, <strong>trend</strong>, or <strong>backtest</strong>.
                </div>
              )}
            </>
          ) : (
            <>
              <div className="learning-section-intro">
                <span className="eyebrow">{selectedSection.title.toUpperCase()}</span>
                <h3>{selectedSection.subtitle}</h3>
              </div>

              {selectedSection.title === "Start Here" && (
                <div className="learning-steps">
                  <div><span>1</span><strong>Search an instrument</strong><p>Choose the exact company, index, or exchange listing.</p></div>
                  <div><span>2</span><strong>Pick a timeframe</strong><p>Start with the timeframe your strategy was designed for.</p></div>
                  <div><span>3</span><strong>Read the market context</strong><p>Check bias, indicators, market structure, and confirmation.</p></div>
                  <div><span>4</span><strong>Read Strategy Evidence</strong><p>Look at historical behavior, uncertainty, drawdowns, and losing streaks.</p></div>
                  <div><span>5</span><strong>Practise before real money</strong><p>Use paper trading to see whether you can actually follow the rules.</p></div>
                </div>
              )}

              <div className="learning-grid">
                {filteredItems.map((item) => (
                  <article className="learning-card" key={item.term}>
                    <h4>{item.term}</h4>
                    <p><strong>In simple words:</strong> {item.plain}</p>
                    <p><strong>How to use it:</strong> {item.use}</p>
                    {item.watch && <p><strong>Watch out for:</strong> {item.watch}</p>}
                  </article>
                ))}
              </div>

              {!filteredItems.length && (
                <div className="learning-empty">Nothing in this section matches your search.</div>
              )}

              {selectedSection.title === "Strategy Evidence" && (
                <div className="learning-warning">
                  <strong>Important:</strong> historical statistics describe the tested sample. A historical win rate is not the probability that the next trade will win. Use the evidence to understand how the strategy behaved, not as a guarantee about the future.
                </div>
              )}
            </>
          )}
        </div>
      </section>
    </div>
  );
}
