import {
  Activity,
  ShieldCheck,
  TrendingDown,
  TrendingUp,
} from "lucide-react";

export default function MarketStructure() {
  return (
    <section className="structure-grid">
      <div className="terminal-card">
        <div className="card-header">
          <div>
            <span className="eyebrow">
              TIMEFRAME ALIGNMENT
            </span>

            <h2>
              Market Structure
            </h2>
          </div>

          <div className="live-badge">
            ENGINE ANALYSIS
          </div>
        </div>

        <div className="structure-items">
          <StructureItem
            label="1H CONFIRMATION"
            value="BULLISH"
            detail="Trend structure positive"
            type="bullish"
          />

          <StructureItem
            label="15M PRIMARY"
            value="BULLISH"
            detail="Momentum improving"
            type="bullish"
          />

          <StructureItem
            label="5M ENTRY"
            value="WAIT"
            detail="Entry confirmation missing"
            type="wait"
          />

          <StructureItem
            label="FINAL STATE"
            value="WAIT"
            detail="Waiting for confirmation"
            type="wait"
            final
          />
        </div>
      </div>

      <div className="terminal-card signal-card">
        <div className="card-header">
          <div>
            <span className="eyebrow">
              SIGNAL ENGINE
            </span>

            <h2>
              Decision
            </h2>
          </div>

          <Activity
            size={18}
            className="muted-icon"
          />
        </div>

        <div className="signal-body">
          <div className="signal-state">
            WAIT
          </div>

          <div className="signal-score">
            <span>
              Setup score
            </span>

            <strong>
              6.4 / 10
            </strong>
          </div>
        </div>

        <div className="signal-bar">
          <div className="signal-bar-fill" />
        </div>

        <p className="signal-explanation">
          The higher-timeframe trend is
          constructive, but the selected
          entry timeframe has not yet
          confirmed the setup.
        </p>

        <div className="signal-tags">
          <span>
            <TrendingUp size={12} />
            HTF bullish
          </span>

          <span>
            <TrendingDown size={12} />
            Entry mixed
          </span>

          <span>
            <ShieldCheck size={12} />
            Risk protected
          </span>
        </div>
      </div>
    </section>
  );
}

function StructureItem({
  label,
  value,
  detail,
  type,
  final = false,
}: {
  label: string;
  value: string;
  detail: string;
  type: "bullish" | "wait";
  final?: boolean;
}) {
  return (
    <div
      className={
        final
          ? "structure-item final"
          : "structure-item"
      }
    >
      <span className="structure-label">
        {label}
      </span>

      <strong
        className={
          type === "bullish"
            ? "bullish"
            : "wait"
        }
      >
        {value}
      </strong>

      <small>
        {detail}
      </small>
    </div>
  );
}