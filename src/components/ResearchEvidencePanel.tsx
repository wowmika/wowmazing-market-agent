import type { RetrievedEvidence } from "../ai/retrieval";

type ResearchEvidencePanelProps = {
  evidence: RetrievedEvidence[];
  runtime: "webgpu" | "wasm" | null;
  loading: boolean;
};

function formatScore(value: number): string {
  if (!Number.isFinite(value)) {
    return "0.00";
  }

  return value.toFixed(2);
}

function formatType(value: string): string {
  return value
    .replace(/[-_]/g, " ")
    .replace(/\b\w/g, (character) => character.toUpperCase());
}

export default function ResearchEvidencePanel({
  evidence,
  runtime,
  loading,
}: ResearchEvidencePanelProps) {
  const runtimeLabel =
    runtime === "webgpu"
      ? "LOCAL WEBGPU"
      : runtime === "wasm"
        ? "LOCAL WASM"
        : "LOCAL RETRIEVAL";

  return (
    <section className="agent-terminal-section">
      <div className="agent-section-heading">
        <div>
          <span className="agent-terminal-kicker">
            PHASE 2 · BROWSER RETRIEVAL
          </span>

          <h3>Research evidence</h3>
        </div>

        <span className="agent-source-label">
          {runtimeLabel}
        </span>
      </div>

      {loading && (
        <div className="agent-research-loading">
          <div className="agent-loading-ring" />

          <div>
            <strong>
              Building local evidence index
            </strong>

            <span>
              Research is being embedded and ranked on
              this device.
            </span>
          </div>
        </div>
      )}

      {!loading && evidence.length === 0 && (
        <div className="agent-research-empty">
          <strong>No local evidence retrieved</strong>

          <span>
            No matching technical, fundamental, strategy,
            or research evidence was found for this query.
          </span>
        </div>
      )}

      {!loading && evidence.length > 0 && (
        <div className="agent-research-evidence-list">
          {evidence.map((item, index) => {
            const sourceUrl =
              item.document.sourceUrl?.trim() || "";

            return (
              <article
                key={`${item.id}-${index}`}
                className="agent-research-evidence-card"
              >
                <div className="agent-research-evidence-top">
                  <div className="agent-research-evidence-title">
                    <span className="agent-research-rank">
                      #{index + 1}
                    </span>

                    <div>
                      <span className="agent-terminal-kicker">
                        {formatType(item.document.type)}
                      </span>

                      <h4>
                        {item.document.title}
                      </h4>
                    </div>
                  </div>

                  <div className="agent-research-score">
                    {formatScore(item.score)}
                  </div>
                </div>

                <p className="agent-research-evidence-text">
                  {item.document.text}
                </p>

                <div className="agent-research-evidence-meta">
                  <span>
                    Source:{" "}
                    <strong>
                      {item.document.source}
                    </strong>
                  </span>

                  <span>
                    Semantic{" "}
                    {formatScore(item.vectorScore)}
                  </span>

                  <span>
                    Keyword{" "}
                    {formatScore(item.lexicalScore)}
                  </span>

                  {item.document.timeframe && (
                    <span>
                      TF: {item.document.timeframe}
                    </span>
                  )}

                  {item.document.exchange && (
                    <span>
                      {item.document.exchange}
                    </span>
                  )}
                </div>

                {sourceUrl && (
                  <a
                    href={sourceUrl}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="agent-research-source-link"
                  >
                    Open source
                  </a>
                )}
              </article>
            );
          })}
        </div>
      )}
    </section>
  );
}