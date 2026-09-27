import {
  Calculator,
  CircleDollarSign,
  ShieldCheck,
} from "lucide-react";

export default function PositionPlanner() {
  return (
    <section className="planner-grid">
      <div className="terminal-card">
        <div className="card-header">
          <div>
            <span className="eyebrow">
              RISK ENGINE
            </span>

            <h2>
              Trader Position Planner
            </h2>
          </div>

          <ShieldCheck
            size={18}
            className="muted-icon"
          />
        </div>

        <div className="plan-grid">
          <PlanCell
            label="ENTRY"
            value="WAIT"
            detail="No confirmed setup"
          />

          <PlanCell
            label="STOP LOSS"
            value="--"
            detail="Waiting"
            tone="negative"
          />

          <PlanCell
            label="TARGET 1"
            value="--"
            detail="Waiting"
            tone="positive"
          />

          <PlanCell
            label="TARGET 2"
            value="--"
            detail="Waiting"
            tone="positive"
          />
        </div>

        <div className="planner-divider" />

        <div className="risk-grid">
          <RiskMetric
            label="TRADING CAPITAL"
            value="₹1,00,000"
          />

          <RiskMetric
            label="RISK / TRADE"
            value="1.00%"
          />

          <RiskMetric
            label="MAX RISK"
            value="₹1,000"
          />

          <RiskMetric
            label="PLANNED SHARES"
            value="0"
          />
        </div>
      </div>

      <div className="terminal-card pnl-card">
        <div className="card-header">
          <div>
            <span className="eyebrow">
              PROFIT / LOSS
            </span>

            <h2>
              Scenario Calculator
            </h2>
          </div>

          <CircleDollarSign
            size={18}
            className="muted-icon"
          />
        </div>

        <div className="pnl-content">
          <div className="calculator-icon">
            <Calculator size={22} />
          </div>

          <strong>
            Waiting for a valid setup
          </strong>

          <p>
            Once the strategy confirms
            an entry, WOWMAZING will
            calculate quantity, capital,
            maximum reference loss and
            scenario profit automatically.
          </p>

          <div className="pnl-placeholder">
            <div>
              <span>
                LOSS @ STOP
              </span>

              <strong className="negative">
                ₹0
              </strong>
            </div>

            <div>
              <span>
                PROFIT @ T1
              </span>

              <strong className="positive">
                ₹0
              </strong>
            </div>

            <div>
              <span>
                PROFIT @ T2
              </span>

              <strong className="positive">
                ₹0
              </strong>
            </div>
          </div>
        </div>
      </div>
    </section>
  );
}

function PlanCell({
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
    <div className="plan-cell">
      <span>
        {label}
      </span>

      <strong
        className={tone}
      >
        {value}
      </strong>

      <small>
        {detail}
      </small>
    </div>
  );
}

function RiskMetric({
  label,
  value,
}: {
  label: string;
  value: string;
}) {
  return (
    <div className="risk-metric">
      <span>
        {label}
      </span>

      <strong>
        {value}
      </strong>
    </div>
  );
}