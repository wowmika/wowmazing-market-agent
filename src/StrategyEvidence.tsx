import {
  AlertTriangle,
  BarChart3,
  Calculator,
  CheckCircle2,
  CircleAlert,
  Gauge,
  ShieldAlert,
  Target,
  TrendingDown,
} from "lucide-react";
import "./components/StrategyEvidence.css";

export interface StrategyMetrics {
  trades: number;
  wins: number;
  losses: number;
  win_rate_pct: number | null;
  loss_rate_pct: number | null;
  average_r: number | null;
  expectancy_r: number | null;
  profit_factor: number | null;
  max_losing_streak: number;
  max_drawdown_r: number;
  total_r: number;
  average_hold_bars: number | null;
  best_trade_r: number | null;
  worst_trade_r: number | null;
}

export interface QuantitativeAnalysis {
  available: boolean;
  reason?: string;

  sample: {
    trades: number;
    wins: number;
    losses: number;
  };

  statistical_uncertainty: {
    win_rate_95_ci_low_pct: number | null;
    win_rate_95_ci_high_pct: number | null;
    expectancy_bootstrap_95_ci_low_r: number | null;
    expectancy_bootstrap_95_ci_high_r: number | null;
    note: string;
  };

  trade_distribution: {
    mean_r: number | null;
    median_r: number | null;
    std_r: number | null;
    p05_r: number | null;
    p25_r: number | null;
    p75_r: number | null;
    p95_r: number | null;
    average_win_r: number | null;
    average_loss_r: number | null;
    payoff_ratio: number | null;
    skewness: number | null;
  };

  risk_adjusted: {
    sharpe_per_trade: number | null;
    sortino_per_trade: number | null;
    note: string;
  };

  expectancy_and_costs: {
    gross_expectancy_before_costs_r: number | null;
    after_slippage_expectancy_r: number | null;
    net_expectancy_after_fees_r: number | null;
    average_slippage_drag_r: number | null;
    average_fee_drag_r: number | null;
    average_total_cost_drag_r: number | null;
  };

  kelly: {
    win_probability_used_pct: number | null;
    full_kelly_pct: number | null;
    half_kelly_pct: number | null;
    quarter_kelly_pct: number | null;
    note: string;
  };

  observed_streaks: {
    historical_max_losing_streak: number;
  };

  monte_carlo: {
    enabled: boolean;
    reason?: string;
    paths?: number;
    horizon_trades?: number;
    seed?: number;
    risk_per_trade_pct?: number;
    ruin_proxy_threshold_pct?: number;
    median_final_equity_pct?: number;
    p05_final_equity_pct?: number;
    p01_final_equity_pct?: number;
    probability_of_loss_pct?: number;
    probability_drawdown_20pct_pct?: number;
    probability_drawdown_50pct_pct?: number;
    probability_of_ruin_proxy_pct?: number;
    median_max_drawdown_pct?: number;
    p95_max_drawdown_pct?: number;
    median_max_losing_streak?: number;
    p95_max_losing_streak?: number;
    assumptions?: string;
  };
}

export interface StrategyEvidenceData {
  strategy: {
    name: string;
    direction: string;
  };

  development: StrategyMetrics;

  out_of_sample: StrategyMetrics;

  combined: StrategyMetrics;

  quantitative_analysis?: QuantitativeAnalysis;

  evidence: {
    evidence_coverage: string;
    train_test_win_rate_gap_pct: number | null;
    expectancy_consistency: string;
    robustness_status: string;
  };

  current_setup: {
    match_pct: number;
    conditions_passed: number;
    conditions_total: number;
    all_conditions_pass: boolean;
    conditions: Array<{
      name: string;
      passed: boolean;
    }>;
  };

  risk_guardrail: {
    configured_risk_per_trade_pct: number;
    historical_max_losing_streak: number;
    illustrative_loss_from_max_streak_pct: number;
    historical_max_drawdown_r: number;
    illustrative_drawdown_at_configured_risk_pct: number;
  };

  data?: {
    candles?: number;
    development_candles?: number;
    out_of_sample_candles?: number;
  };
}

export const DEMO_EVIDENCE: StrategyEvidenceData = {
  strategy: {
    name: "Momentum-15 v1",
    direction: "LONG",
  },

  data: {
    candles: 3075,
    development_candles: 2152,
    out_of_sample_candles: 923,
  },

  development: {
    trades: 33,
    wins: 8,
    losses: 25,
    win_rate_pct: 24.24,
    loss_rate_pct: 75.76,
    average_r: -0.4575,
    expectancy_r: -0.4575,
    profit_factor: 0.416,
    max_losing_streak: 12,
    max_drawdown_r: -23.0344,
    total_r: -15.0975,
    average_hold_bars: null,
    best_trade_r: null,
    worst_trade_r: null,
  },

  out_of_sample: {
    trades: 9,
    wins: 1,
    losses: 8,
    win_rate_pct: 11.11,
    loss_rate_pct: 88.89,
    average_r: -0.882,
    expectancy_r: -0.882,
    profit_factor: 0.416,
    max_losing_streak: 4,
    max_drawdown_r: -7.938,
    total_r: -7.938,
    average_hold_bars: null,
    best_trade_r: null,
    worst_trade_r: null,
  },

  combined: {
    trades: 42,
    wins: 9,
    losses: 33,
    win_rate_pct: 21.43,
    loss_rate_pct: 78.57,
    average_r: -0.5484,
    expectancy_r: -0.5484,
    profit_factor: 0.416,
    max_losing_streak: 12,
    max_drawdown_r: -23.0344,
    total_r: -23.0344,
    average_hold_bars: null,
    best_trade_r: null,
    worst_trade_r: null,
  },

  evidence: {
    evidence_coverage: "LIMITED",
    train_test_win_rate_gap_pct: 13.13,
    expectancy_consistency:
      "NOT POSITIVE IN DEVELOPMENT PERIOD",
    robustness_status: "BASIC HOLDOUT TEST ONLY",
  },

  current_setup: {
    match_pct: 60,
    conditions_passed: 3,
    conditions_total: 5,
    all_conditions_pass: false,

    conditions: [
      {
        name: "Price above VWAP",
        passed: true,
      },
      {
        name: "Price above EMA20",
        passed: true,
      },
      {
        name: "EMA20 above EMA50",
        passed: true,
      },
      {
        name: "RSI range",
        passed: false,
      },
      {
        name: "Volume ratio",
        passed: false,
      },
    ],
  },

  risk_guardrail: {
    configured_risk_per_trade_pct: 1,
    historical_max_losing_streak: 12,
    illustrative_loss_from_max_streak_pct: 12,
    historical_max_drawdown_r: -23.0344,
    illustrative_drawdown_at_configured_risk_pct:
      -23.0344,
  },
};

interface StrategyEvidenceProps {
  evidence?: StrategyEvidenceData;
  loading?: boolean;
  onRunBacktest?: () => void;
}

function formatNumber(
  value: number | null,
  decimals = 2,
): string {
  if (value === null || Number.isNaN(value)) {
    return "—";
  }

  return value.toFixed(decimals);
}

function formatPercent(
  value: number | null,
): string {
  if (value === null || Number.isNaN(value)) {
    return "—";
  }

  return `${value.toFixed(2)}%`;
}

function formatR(
  value: number | null,
): string {
  if (value === null || Number.isNaN(value)) {
    return "—";
  }

  return `${value >= 0 ? "+" : ""}${value.toFixed(2)}R`;
}

function formatDrawdownR(
  value: number | null,
): string {
  if (value === null || Number.isNaN(value)) {
    return "—";
  }

  return `-${Math.abs(value).toFixed(2)}R`;
}

function formatRangePercent(
  low: number | null | undefined,
  high: number | null | undefined,
): string {
  if (
    low === null ||
    low === undefined ||
    high === null ||
    high === undefined ||
    Number.isNaN(low) ||
    Number.isNaN(high)
  ) {
    return "—";
  }

  return `${low.toFixed(2)}% – ${high.toFixed(2)}%`;
}

function EvidenceBadge({
  coverage,
}: {
  coverage: string;
}) {
  const normalized = coverage.toUpperCase();

  let className = "evidence-badge limited";
  let icon = <AlertTriangle size={14} />;

  if (normalized === "HIGH") {
    className = "evidence-badge high";
    icon = <CheckCircle2 size={14} />;
  } else if (normalized === "MEDIUM") {
    className = "evidence-badge medium";
    icon = <CircleAlert size={14} />;
  }

  return (
    <div className={className}>
      {icon}
      <span>{normalized} EVIDENCE</span>
    </div>
  );
}

function MetricCard({
  label,
  value,
  helper,
  negative = false,
  positive = false,
}: {
  label: string;
  value: string;
  helper?: string;
  negative?: boolean;
  positive?: boolean;
}) {
  return (
    <div className="evidence-metric">
      <div className="evidence-metric-label">
        {label}
      </div>

      <div
        className={[
          "evidence-metric-value",
          negative ? "negative" : "",
          positive ? "positive" : "",
        ]
          .filter(Boolean)
          .join(" ")}
      >
        {value}
      </div>

      {helper && (
        <div className="evidence-metric-helper">
          {helper}
        </div>
      )}
    </div>
  );
}

export default function StrategyEvidence({
  evidence = DEMO_EVIDENCE,
  loading = false,
  onRunBacktest,
}: StrategyEvidenceProps) {
  const combined = evidence.combined;
  const development = evidence.development;
  const outOfSample = evidence.out_of_sample;
  const current = evidence.current_setup;
  const risk = evidence.risk_guardrail;
  const quant = evidence.quantitative_analysis;

  const warnings: string[] = [];

  if (combined.trades < 50) {
    warnings.push(
      `Only ${combined.trades} historical trades. More evidence is needed.`,
    );
  }

  if (
    combined.expectancy_r !== null &&
    combined.expectancy_r <= 0
  ) {
    warnings.push(
      "Historical expectancy is negative.",
    );
  }

  if (
    combined.profit_factor !== null &&
    combined.profit_factor < 1
  ) {
    warnings.push(
      "Profit factor is below 1.0.",
    );
  }

  if (
    evidence.evidence.train_test_win_rate_gap_pct !==
      null &&
    evidence.evidence.train_test_win_rate_gap_pct > 10
  ) {
    warnings.push(
      "Development and out-of-sample win rates differ materially.",
    );
  }

  if (!current.all_conditions_pass) {
    warnings.push(
      `Current setup is incomplete: ${current.conditions_passed}/${current.conditions_total} rules pass.`,
    );
  }

  if (risk.historical_max_losing_streak >= 8) {
    warnings.push(
      `${risk.historical_max_losing_streak}-trade historical losing streak detected.`,
    );
  }

  if (
    quant?.available &&
    quant.statistical_uncertainty.win_rate_95_ci_low_pct !== null &&
    quant.statistical_uncertainty.win_rate_95_ci_high_pct !== null
  ) {
    const ciWidth =
      quant.statistical_uncertainty.win_rate_95_ci_high_pct -
      quant.statistical_uncertainty.win_rate_95_ci_low_pct;

    if (ciWidth >= 20) {
      warnings.push(
        `The 95% win-rate confidence interval is wide (${ciWidth.toFixed(1)} percentage points), so the observed win rate is statistically uncertain.`,
      );
    }
  }

  return (
    <section className="strategy-evidence">
      <div className="evidence-header">
        <div>
          <div className="evidence-eyebrow">
            STRATEGY EVIDENCE ENGINE
          </div>

          <div className="evidence-title-row">
            <h2>{evidence.strategy.name}</h2>

            <span className="direction-badge">
              {evidence.strategy.direction}
            </span>
          </div>

          <p className="evidence-subtitle">
            Historical research, out-of-sample validation,
            failure analysis and current setup matching.
          </p>
        </div>

        <EvidenceBadge
          coverage={
            evidence.evidence.evidence_coverage
          }
        />
      </div>

      <div className="evidence-grid metrics-primary">
        <MetricCard
          label="Historical Trades"
          value={combined.trades.toString()}
          helper={`${evidence.data?.candles ?? "—"} candles tested`}
        />

        <MetricCard
          label="Historical Win Rate"
          value={formatPercent(
            combined.win_rate_pct,
          )}
          helper="Descriptive statistic"
        />

        <MetricCard
          label="Out-of-Sample Win Rate"
          value={formatPercent(
            outOfSample.win_rate_pct,
          )}
          helper={`${outOfSample.trades} OOS trades`}
        />

        <MetricCard
          label="Expectancy"
          value={formatR(
            combined.expectancy_r,
          )}
          helper="Average result per trade"
          negative={
            combined.expectancy_r !== null &&
            combined.expectancy_r < 0
          }
        />
      </div>

      <div className="evidence-grid metrics-secondary">
        <MetricCard
          label="Profit Factor"
          value={formatNumber(
            combined.profit_factor,
            3,
          )}
          helper="Gross profit / gross loss"
          negative={
            combined.profit_factor !== null &&
            combined.profit_factor < 1
          }
        />

        <MetricCard
          label="Max Losing Streak"
          value={`${combined.max_losing_streak}`}
          helper="Consecutive historical losses"
          negative={
            combined.max_losing_streak >= 8
          }
        />

        <MetricCard
          label="Max Drawdown"
          value={formatR(
            combined.max_drawdown_r,
          )}
          helper="Historical peak-to-trough"
          negative
        />

        <MetricCard
          label="OOS Win-Rate Gap"
          value={formatPercent(
            evidence.evidence
              .train_test_win_rate_gap_pct,
          )}
          helper="Development vs OOS"
          negative={
            evidence.evidence
              .train_test_win_rate_gap_pct !==
              null &&
            evidence.evidence
              .train_test_win_rate_gap_pct > 10
          }
        />
      </div>

      <div className="evidence-two-column">
        <div className="evidence-panel">
          <div className="panel-heading">
            <div className="panel-heading-icon">
              <BarChart3 size={17} />
            </div>

            <div>
              <h3>Development vs Out-of-Sample</h3>
              <span>
                Chronological holdout comparison
              </span>
            </div>
          </div>

          <div className="comparison-table">
            <div className="comparison-row comparison-head">
              <span></span>
              <span>Development</span>
              <span>OOS</span>
            </div>

            <div className="comparison-row">
              <span>Trades</span>
              <strong>
                {development.trades}
              </strong>
              <strong>
                {outOfSample.trades}
              </strong>
            </div>

            <div className="comparison-row">
              <span>Win Rate</span>
              <strong>
                {formatPercent(
                  development.win_rate_pct,
                )}
              </strong>
              <strong>
                {formatPercent(
                  outOfSample.win_rate_pct,
                )}
              </strong>
            </div>

            <div className="comparison-row">
              <span>Expectancy</span>
              <strong
                className={
                  (development.expectancy_r ??
                    0) < 0
                    ? "negative"
                    : "positive"
                }
              >
                {formatR(
                  development.expectancy_r,
                )}
              </strong>

              <strong
                className={
                  (outOfSample.expectancy_r ??
                    0) < 0
                    ? "negative"
                    : "positive"
                }
              >
                {formatR(
                  outOfSample.expectancy_r,
                )}
              </strong>
            </div>

            <div className="comparison-row">
              <span>Max Losing Streak</span>
              <strong>
                {development.max_losing_streak}
              </strong>
              <strong>
                {outOfSample.max_losing_streak}
              </strong>
            </div>
          </div>

          <div className="consistency-note">
            <CircleAlert size={15} />
            <span>
              {evidence.evidence.expectancy_consistency}
            </span>
          </div>
        </div>

        <div className="evidence-panel">
          <div className="panel-heading">
            <div className="panel-heading-icon">
              <Target size={17} />
            </div>

            <div>
              <h3>Current Setup Match</h3>
              <span>
                Does today's setup satisfy the tested rules?
              </span>
            </div>
          </div>

          <div className="match-header">
            <div className="match-number">
              {current.match_pct.toFixed(0)}%
            </div>

            <div>
              <div className="match-label">
                Rules satisfied
              </div>

              <div className="match-count">
                {current.conditions_passed} /{" "}
                {current.conditions_total}
              </div>
            </div>
          </div>

          <div className="match-progress">
            <div
              className="match-progress-fill"
              style={{
                width: `${current.match_pct}%`,
              }}
            />
          </div>

          <div className="conditions-list">
            {current.conditions.map(
              (condition) => (
                <div
                  className="condition-row"
                  key={condition.name}
                >
                  {condition.passed ? (
                    <CheckCircle2
                      size={16}
                      className="condition-pass"
                    />
                  ) : (
                    <CircleAlert
                      size={16}
                      className="condition-fail"
                    />
                  )}

                  <span>
                    {condition.name}
                  </span>

                  <strong>
                    {condition.passed
                      ? "PASS"
                      : "FAIL"}
                  </strong>
                </div>
              ),
            )}
          </div>
        </div>
      </div>

      <div className="evidence-two-column">
        <div className="evidence-panel danger-panel">
          <div className="panel-heading">
            <div className="panel-heading-icon danger">
              <ShieldAlert size={17} />
            </div>

            <div>
              <h3>Failure History</h3>
              <span>
                What happened when this strategy failed?
              </span>
            </div>
          </div>

          <div className="failure-stat-grid">
            <div>
              <span>Max losing streak</span>
              <strong>
                {risk.historical_max_losing_streak} trades
              </strong>
            </div>

            <div>
              <span>Max historical drawdown</span>
              <strong className="negative">
                {formatDrawdownR(
                  risk.historical_max_drawdown_r,
                )}
              </strong>
            </div>

            <div>
              <span>Configured risk / trade</span>
              <strong>
                {formatPercent(
                  risk.configured_risk_per_trade_pct,
                )}
              </strong>
            </div>

            <div>
              <span>Illustrative streak impact</span>
              <strong className="negative">
                -
                {
                  risk.illustrative_loss_from_max_streak_pct
                }
                %
              </strong>
            </div>
          </div>

          <div className="risk-disclaimer">
            <Gauge size={15} />

            <span>
              The platform does not infer a recommended
              risk percentage from win rate. The figures
              above illustrate what the user's configured
              risk would have meant during historical
              losing periods.
            </span>
          </div>
        </div>

        <div className="evidence-panel warning-panel">
          <div className="panel-heading">
            <div className="panel-heading-icon warning">
              <AlertTriangle size={17} />
            </div>

            <div>
              <h3>Evidence Warnings</h3>
              <span>
                Conditions that reduce confidence in the result
              </span>
            </div>
          </div>

          <div className="warning-list">
            {warnings.map(
              (warning, index) => (
                <div
                  className="warning-row"
                  key={`${warning}-${index}`}
                >
                  <AlertTriangle size={15} />

                  <span>{warning}</span>
                </div>
              ),
            )}
          </div>
        </div>
      </div>

      <div className="evidence-two-column">
        <div className="evidence-panel">
          <div className="panel-heading">
            <div className="panel-heading-icon">
              <Calculator size={17} />
            </div>

            <div>
              <h3>Quantitative Research</h3>
              <span>
                Statistical uncertainty, distributions and risk-adjusted evidence
              </span>
            </div>
          </div>

          {quant?.available ? (
            <>
              <div className="evidence-grid metrics-secondary">
                <MetricCard
                  label="Win-Rate 95% CI"
                  value={formatRangePercent(
                    quant.statistical_uncertainty
                      .win_rate_95_ci_low_pct,
                    quant.statistical_uncertainty
                      .win_rate_95_ci_high_pct,
                  )}
                  helper={`${quant.sample.trades} completed trades`}
                />

                <MetricCard
                  label="Expectancy 95% CI"
                  value={
                    quant.statistical_uncertainty
                      .expectancy_bootstrap_95_ci_low_r !==
                      null &&
                    quant.statistical_uncertainty
                      .expectancy_bootstrap_95_ci_high_r !==
                      null
                      ? `${formatR(
                          quant.statistical_uncertainty
                            .expectancy_bootstrap_95_ci_low_r,
                        )} – ${formatR(
                          quant.statistical_uncertainty
                            .expectancy_bootstrap_95_ci_high_r,
                        )}`
                      : "—"
                  }
                  helper="Bootstrap estimate"
                />

                <MetricCard
                  label="Median Trade"
                  value={formatR(
                    quant.trade_distribution.median_r,
                  )}
                  helper="50th percentile"
                />

                <MetricCard
                  label="Payoff Ratio"
                  value={formatNumber(
                    quant.trade_distribution.payoff_ratio,
                    3,
                  )}
                  helper="Avg win / avg loss magnitude"
                />

                <MetricCard
                  label="Sharpe / Trade"
                  value={formatNumber(
                    quant.risk_adjusted
                      .sharpe_per_trade,
                    3,
                  )}
                  helper="Not annualized"
                />

                <MetricCard
                  label="Sortino / Trade"
                  value={formatNumber(
                    quant.risk_adjusted
                      .sortino_per_trade,
                    3,
                  )}
                  helper="Downside-focused"
                />
              </div>

              <div className="consistency-note">
                <Calculator size={15} />
                <span>
                  {quant.statistical_uncertainty.note}
                </span>
              </div>
            </>
          ) : (
            <div className="consistency-note">
              <CircleAlert size={15} />
              <span>
                The quantitative engine is implemented in the backend.
                This card will populate once the live strategy-evidence
                API passes its quantitative_analysis object to the UI.
              </span>
            </div>
          )}
        </div>

        <div className="evidence-panel">
          <div className="panel-heading">
            <div className="panel-heading-icon">
              <Gauge size={17} />
            </div>

            <div>
              <h3>Kelly &amp; Cost Sensitivity</h3>
              <span>
                Mathematical sizing output and execution-cost drag
              </span>
            </div>
          </div>

          {quant?.available ? (
            <>
              <div className="comparison-table">
                <div className="comparison-row comparison-head">
                  <span>Kelly calculation</span>
                  <span>Value</span>
                  <span></span>
                </div>

                <div className="comparison-row">
                  <span>Full Kelly</span>
                  <strong>
                    {formatPercent(
                      quant.kelly.full_kelly_pct,
                    )}
                  </strong>
                  <span></span>
                </div>

                <div className="comparison-row">
                  <span>Half Kelly</span>
                  <strong>
                    {formatPercent(
                      quant.kelly.half_kelly_pct,
                    )}
                  </strong>
                  <span></span>
                </div>

                <div className="comparison-row">
                  <span>Quarter Kelly</span>
                  <strong>
                    {formatPercent(
                      quant.kelly.quarter_kelly_pct,
                    )}
                  </strong>
                  <span></span>
                </div>
              </div>

              <div className="evidence-grid metrics-secondary">
                <MetricCard
                  label="Before Costs"
                  value={formatR(
                    quant.expectancy_and_costs
                      .gross_expectancy_before_costs_r,
                  )}
                  helper="Gross expectancy"
                />

                <MetricCard
                  label="After Slippage"
                  value={formatR(
                    quant.expectancy_and_costs
                      .after_slippage_expectancy_r,
                  )}
                  helper="Execution-adjusted"
                />

                <MetricCard
                  label="After Fees"
                  value={formatR(
                    quant.expectancy_and_costs
                      .net_expectancy_after_fees_r,
                  )}
                  helper="Net expectancy"
                />

                <MetricCard
                  label="Total Cost Drag"
                  value={formatR(
                    quant.expectancy_and_costs
                      .average_total_cost_drag_r !==
                      null
                      ? -Math.abs(
                          quant.expectancy_and_costs
                            .average_total_cost_drag_r,
                        )
                      : null,
                  )}
                  helper="R lost to modeled costs"
                  negative
                />
              </div>

              <div className="risk-disclaimer">
                <Gauge size={15} />
                <span>
                  {quant.kelly.note}
                </span>
              </div>
            </>
          ) : (
            <div className="consistency-note">
              <CircleAlert size={15} />
              <span>
                Kelly and cost decomposition will appear with the live
                quantitative-analysis response.
              </span>
            </div>
          )}
        </div>
      </div>

      <div className="evidence-two-column">
        <div className="evidence-panel">
          <div className="panel-heading">
            <div className="panel-heading-icon">
              <BarChart3 size={17} />
            </div>

            <div>
              <h3>Trade Distribution</h3>
              <span>
                How widely individual outcomes are dispersed
              </span>
            </div>
          </div>

          {quant?.available ? (
            <div className="comparison-table">
              <div className="comparison-row comparison-head">
                <span>Statistic</span>
                <span>R</span>
                <span></span>
              </div>

              <div className="comparison-row">
                <span>5th percentile</span>
                <strong>{formatR(quant.trade_distribution.p05_r)}</strong>
                <span></span>
              </div>

              <div className="comparison-row">
                <span>25th percentile</span>
                <strong>{formatR(quant.trade_distribution.p25_r)}</strong>
                <span></span>
              </div>

              <div className="comparison-row">
                <span>Median</span>
                <strong>{formatR(quant.trade_distribution.median_r)}</strong>
                <span></span>
              </div>

              <div className="comparison-row">
                <span>75th percentile</span>
                <strong>{formatR(quant.trade_distribution.p75_r)}</strong>
                <span></span>
              </div>

              <div className="comparison-row">
                <span>95th percentile</span>
                <strong>{formatR(quant.trade_distribution.p95_r)}</strong>
                <span></span>
              </div>

              <div className="comparison-row">
                <span>Skewness</span>
                <strong>
                  {formatNumber(
                    quant.trade_distribution.skewness,
                    3,
                  )}
                </strong>
                <span></span>
              </div>
            </div>
          ) : (
            <div className="consistency-note">
              <CircleAlert size={15} />
              <span>
                Trade-distribution percentiles will populate from the
                completed backtest trade list.
              </span>
            </div>
          )}
        </div>

        <div className="evidence-panel">
          <div className="panel-heading">
            <div className="panel-heading-icon">
              <ShieldAlert size={17} />
            </div>

            <div>
              <h3>Monte Carlo Stress Test</h3>
              <span>
                10,000 randomized paths using historical trade outcomes
              </span>
            </div>
          </div>

          {quant?.available &&
          quant.monte_carlo.enabled ? (
            <>
              <div className="evidence-grid metrics-secondary">
                <MetricCard
                  label="Median Ending Equity"
                  value={
                    quant.monte_carlo
                      .median_final_equity_pct !==
                    undefined
                      ? `${quant.monte_carlo.median_final_equity_pct.toFixed(1)}%`
                      : "—"
                  }
                  helper={`${quant.monte_carlo.paths ?? "—"} paths`}
                />

                <MetricCard
                  label="5th Percentile"
                  value={
                    quant.monte_carlo
                      .p05_final_equity_pct !==
                    undefined
                      ? `${quant.monte_carlo.p05_final_equity_pct.toFixed(1)}%`
                      : "—"
                  }
                  helper={`${quant.monte_carlo.horizon_trades ?? "—"}-trade horizon`}
                />

                <MetricCard
                  label="P(>20% Drawdown)"
                  value={formatPercent(
                    quant.monte_carlo
                      .probability_drawdown_20pct_pct ??
                      null,
                  )}
                  helper="Simulation frequency"
                  negative
                />

                <MetricCard
                  label="Ruin Proxy"
                  value={formatPercent(
                    quant.monte_carlo
                      .probability_of_ruin_proxy_pct ??
                      null,
                  )}
                  helper="50% drawdown threshold"
                  negative
                />

                <MetricCard
                  label="Median Max DD"
                  value={
                    quant.monte_carlo
                      .median_max_drawdown_pct !==
                    undefined
                      ? `-${quant.monte_carlo.median_max_drawdown_pct.toFixed(1)}%`
                      : "—"
                  }
                  helper="Across simulations"
                />

                <MetricCard
                  label="95th %ile Losing Streak"
                  value={
                    quant.monte_carlo
                      .p95_max_losing_streak !==
                    undefined
                      ? `${quant.monte_carlo.p95_max_losing_streak}`
                      : "—"
                  }
                  helper="Simulated maximum streak"
                />
              </div>

              <div className="risk-disclaimer">
                <ShieldAlert size={15} />
                <span>
                  {quant.monte_carlo.assumptions}
                </span>
              </div>
            </>
          ) : (
            <div className="consistency-note">
              <CircleAlert size={15} />
              <span>
                Monte Carlo requires the live quantitative-analysis
                object. The simulation resamples historical net-R
                outcomes; it is not a prediction engine.
              </span>
            </div>
          )}
        </div>
      </div>

      <div className="evidence-footer">
        <div className="footer-icon">
          <TrendingDown size={16} />
        </div>

        <div>
          <strong>
            Historical evidence ≠ next-trade probability
          </strong>

          <p>
            Win rate, expectancy, drawdown and losing streak
            are descriptive results from the selected
            historical test. They are not guarantees or a
            prediction of the next trade.
          </p>
        </div>

        {onRunBacktest && (
          <button
            className="run-backtest-button"
            onClick={onRunBacktest}
            disabled={loading}
          >
            {loading
              ? "Running..."
              : "Run Backtest"}
          </button>
        )}
      </div>
    </section>
  );
}