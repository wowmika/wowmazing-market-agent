import { create, insert, search, type AnyOrama } from "@orama/orama";
import { EMBEDDING_DIMENSIONS, embedText, embedTexts } from "./embeddings";
import type { ResearchAtom, ResearchAtomType, RetrievedEvidence } from "./types";

const LEXICAL_WEIGHT = 0.22;
const VECTOR_WEIGHT = 0.36;
const IMPORTANCE_WEIGHT = 0.08;
const TYPE_WEIGHT = 0.16;
const TIMEFRAME_WEIGHT = 0.06;
const TARGET_WEIGHT = 0.12;

export type RetrievalIndex = AnyOrama;

export type QueryIntent =
  | "technical"
  | "fundamental"
  | "strategy"
  | "market"
  | "research"
  | "mixed";

export function createRetrievalIndex(): RetrievalIndex {
  return create({
    schema: {
      id: "string",
      symbol: "string",
      type: "enum",
      title: "string",
      text: "string",
      source: "string",
      sourceUrl: "string",
      timestamp: "string",
      timeframe: "string",
      exchange: "string",
      market: "string",
      importance: "number",
      embedding: `vector[${EMBEDDING_DIMENSIONS}]`,
    },
    sort: { enabled: false },
  });
}

export async function buildRetrievalIndex(
  atoms: ResearchAtom[],
  onProgress?: (progress: number) => void,
) {
  const db = createRetrievalIndex();
  const embeddingTexts = atoms.map((atom) => `${atom.title}\n${atom.text}`);
  const embedded = await embedTexts(embeddingTexts, onProgress);

  for (let i = 0; i < atoms.length; i += 1) {
    const atom = atoms[i];
    const embedding = embedded.embeddings[i];

    if (!embedding || embedding.length !== EMBEDDING_DIMENSIONS) {
      throw new Error(`Embedding dimension mismatch for ${atom.id}.`);
    }

    await insert(db, {
      ...atom,
      sourceUrl: atom.sourceUrl ?? "",
      timestamp: atom.timestamp ?? "",
      timeframe: atom.timeframe ?? "",
      exchange: atom.exchange ?? "",
      market: atom.market ?? "",
      embedding,
    });
  }

  return {
    db,
    embeddingRuntime: embedded.runtime,
    embeddingFallbackUsed: embedded.fallbackUsed,
    indexedCount: atoms.length,
  };
}

function normalize(values: number[]) {
  if (!values.length) return [] as number[];

  const min = Math.min(...values);
  const max = Math.max(...values);

  if (max === min) return values.map(() => 1);

  return values.map((value) => (value - min) / (max - min));
}

function normalizeQuery(query: string): string {
  return query.trim().toLowerCase().replace(/\s+/g, " ");
}

function scoreKeywords(query: string, keywords: string[]): number {
  return keywords.reduce((score, keyword) => {
    return score + (query.includes(keyword) ? 1 : 0);
  }, 0);
}

function detectQueryIntent(query: string): QueryIntent {
  const normalized = normalizeQuery(query);

  const technicalScore =
    scoreKeywords(normalized, [
      "rsi",
      "vwap",
      "ema",
      "ema20",
      "ema50",
      "atr",
      "macd",
      "volume",
      "price action",
      "trend",
      "support",
      "resistance",
      "breakout",
      "breakdown",
      "momentum",
      "candle",
      "technical",
      "intraday",
      "scalp",
      "5m",
      "15m",
      "30m",
      "1h",
      "4h",
    ]) + (/\b\d+(?:m|h)\b/.test(normalized) ? 2 : 0);

  const fundamentalScore = scoreKeywords(normalized, [
    "fundamental",
    "fundamentals",
    "p/e",
    "pe ratio",
    "eps",
    "revenue",
    "growth",
    "profit",
    "margin",
    "operating margin",
    "market cap",
    "dividend",
    "valuation",
    "earnings",
    "debt",
    "roe",
    "financial",
    "balance sheet",
    "cash flow",
  ]);

  const strategyScore = scoreKeywords(normalized, [
    "setup",
    "signal",
    "entry",
    "exit",
    "target",
    "stop loss",
    "stop-loss",
    "risk",
    "invalidation",
    "bias",
    "bullish",
    "bearish",
    "trade",
    "actionability",
    "strategy",
  ]);

  const marketScore = scoreKeywords(normalized, [
    "market",
    "nse",
    "cash market",
    "index",
    "sector",
    "sensex",
    "nifty",
  ]);

  const researchScore = scoreKeywords(normalized, [
    "news",
    "research",
    "filing",
    "announcement",
    "catalyst",
    "sebi",
    "nse filing",
    "result",
    "results",
    "acquisition",
    "merger",
  ]);

  const scores = [
    ["technical", technicalScore],
    ["fundamental", fundamentalScore],
    ["strategy", strategyScore],
    ["market", marketScore],
    ["research", researchScore],
  ] as const;

  const ranked = [...scores].sort((a, b) => b[1] - a[1]);
  const highest = ranked[0];
  const second = ranked[1];

  if (highest[1] === 0) return "mixed";
  if (second[1] > 0 && highest[1] - second[1] <= 1) return "mixed";

  return highest[0];
}

function typeRelevance(
  atomType: ResearchAtomType,
  intent: QueryIntent,
): number {
  if (intent === "technical") {
    return {
      technical: 1,
      strategy: 0.86,
      market: 0.74,
      research: 0.40,
      fundamental: 0.24,
    }[atomType];
  }

  if (intent === "fundamental") {
    return {
      fundamental: 1,
      research: 0.68,
      market: 0.52,
      strategy: 0.38,
      technical: 0.24,
    }[atomType];
  }

  if (intent === "strategy") {
    return {
      strategy: 1,
      technical: 0.88,
      market: 0.74,
      fundamental: 0.48,
      research: 0.38,
    }[atomType];
  }

  if (intent === "market") {
    return {
      market: 1,
      technical: 0.84,
      strategy: 0.72,
      fundamental: 0.48,
      research: 0.36,
    }[atomType];
  }

  if (intent === "research") {
    return {
      research: 1,
      strategy: 0.56,
      fundamental: 0.58,
      market: 0.48,
      technical: 0.38,
    }[atomType];
  }

  return 0.65;
}

function timeframeFromQuery(query: string): string | null {
  const match = query.match(/\b(1m|3m|5m|15m|30m|1h|4h|1d|1w)\b/i);
  return match?.[1]?.toLowerCase() ?? null;
}


function targetTermsForIntent(intent: QueryIntent): string[] {
  if (intent === "technical") {
    return [
      "rsi",
      "vwap",
      "ema",
      "ema20",
      "ema50",
      "atr",
      "macd",
      "volume",
      "price action",
      "trend",
      "support",
      "resistance",
      "breakout",
      "breakdown",
      "momentum",
    ];
  }

  if (intent === "fundamental") {
    return [
      "p/e",
      "pe ratio",
      "eps",
      "revenue",
      "revenue growth",
      "growth",
      "profit",
      "margin",
      "operating margin",
      "market cap",
      "dividend",
      "valuation",
      "earnings",
      "debt",
      "roe",
      "cash flow",
    ];
  }

  if (intent === "strategy") {
    return [
      "setup",
      "signal",
      "entry",
      "exit",
      "target",
      "stop loss",
      "stop-loss",
      "risk",
      "invalidation",
      "bias",
      "actionability",
      "strategy",
    ];
  }

  if (intent === "market") {
    return [
      "market",
      "nse",
      "cash market",
      "index",
      "sector",
      "sensex",
      "nifty",
    ];
  }

  if (intent === "research") {
    return [
      "news",
      "research",
      "filing",
      "announcement",
      "catalyst",
      "sebi",
      "nse filing",
      "result",
      "results",
      "acquisition",
      "merger",
    ];
  }

  return [];
}

function targetRelevance(
  query: string,
  atom: ResearchAtom,
  intent: QueryIntent,
): number {
  const terms = targetTermsForIntent(intent);
  if (!terms.length) return 0.5;

  const normalizedQuery = normalizeQuery(query);
  const title = normalizeQuery(atom.title);
  const text = normalizeQuery(atom.text);

  let matched = 0;
  for (const term of terms) {
    const inQuery = normalizedQuery.includes(term);
    if (!inQuery) continue;
    if (title.includes(term)) matched += 1;
    else if (text.includes(term)) matched += 0.45;
  }

  if (!matched) return 0;

  return Math.min(1, matched / Math.max(1, Math.min(3, terms.filter((term) => normalizedQuery.includes(term)).length)));
}

const GENERIC_METADATA_TITLES = new Set([
  "company",
  "symbol",
  "exchange",
  "market",
  "instrument",
]);

function isGenericMetadataAtom(atom: ResearchAtom): boolean {
  return GENERIC_METADATA_TITLES.has(normalizeQuery(atom.title));
}

function allowedTypesForIntent(intent: QueryIntent): ResearchAtomType[] | null {
  if (intent === "technical") {
    return ["technical", "strategy", "market", "research"];
  }

  if (intent === "fundamental") {
    return ["fundamental", "research", "market"];
  }

  if (intent === "strategy") {
    return ["strategy", "technical", "market", "research"];
  }

  if (intent === "market") {
    return ["market", "technical", "strategy", "research", "fundamental"];
  }

  if (intent === "research") {
    return ["research", "fundamental", "market", "strategy", "technical"];
  }

  return null;
}

function metadataPenalty(atom: ResearchAtom, intent: QueryIntent): number {
  if (!isGenericMetadataAtom(atom)) return 0;

  if (intent === "mixed" || intent === "market") return 0.08;
  return 0.40;
}

function timeframeRelevance(
  atom: ResearchAtom,
  queryTimeframe: string | null,
  intent: QueryIntent,
): number {
  if (!queryTimeframe) return 0.5;

  const atomTimeframe = atom.timeframe?.trim().toLowerCase();

  if (!atomTimeframe) {
    return intent === "fundamental" || intent === "research" ? 0.62 : 0.38;
  }

  if (atomTimeframe === queryTimeframe) return 1;

  return intent === "technical" || intent === "strategy" ? 0.18 : 0.45;
}

export async function searchRetrievalIndex(
  db: RetrievalIndex,
  query: string,
  options?: {
    limit?: number;
    symbol?: string;
    type?: ResearchAtom["type"];
    intent?: QueryIntent;
  },
): Promise<RetrievedEvidence[]> {
  const limit = options?.limit ?? 6;
  const intent = options?.intent ?? detectQueryIntent(query);
  const queryTimeframe = timeframeFromQuery(query);
  const where: Record<string, unknown> = {};

  if (options?.symbol) where.symbol = options.symbol;
  if (options?.type) where.type = options.type;

  const candidateLimit = Math.max(16, limit * 4);

  const lexical = await search(db, {
    term: query,
    properties: ["title", "text", "source", "symbol"],
    limit: candidateLimit,
    where: Object.keys(where).length ? where : undefined,
  });

  const queryEmbedding = await embedText(query);
  const vector = await search(db, {
    mode: "vector",
    vector: { value: queryEmbedding, property: "embedding" },
    similarity: 0,
    limit: candidateLimit,
    where: Object.keys(where).length ? where : undefined,
  });

  const lexicalMap = new Map(
    lexical.hits.map((hit) => [String(hit.id), hit.score]),
  );
  const vectorMap = new Map(
    vector.hits.map((hit) => [String(hit.id), hit.score]),
  );

  const allIds = new Set([
    ...lexicalMap.keys(),
    ...vectorMap.keys(),
  ]);

  const rawCandidates = [...allIds].map((id) => {
    const hit =
      lexical.hits.find((item) => String(item.id) === id) ??
      vector.hits.find((item) => String(item.id) === id);

    const document = hit!.document as ResearchAtom & {
      embedding: number[];
    };

    return {
      id,
      lexicalScore: lexicalMap.get(id) ?? 0,
      vectorScore: vectorMap.get(id) ?? 0,
      document,
    };
  });

  // Focused intents should not let unrelated evidence types or generic
  // metadata enter the final context when enough relevant evidence exists.
  // This is intentionally a soft fallback: if gating would leave too few
  // candidates, we search the full candidate set rather than returning an
  // empty or misleading result.
  const allowedTypes = allowedTypesForIntent(intent);
  const gatedCandidates =
    allowedTypes && intent !== "mixed"
      ? rawCandidates.filter(
          (candidate) =>
            allowedTypes.includes(candidate.document.type) &&
            !isGenericMetadataAtom(candidate.document),
        )
      : rawCandidates.filter(
          (candidate) => !isGenericMetadataAtom(candidate.document),
        );

  const candidatePool =
    gatedCandidates.length >= Math.min(limit, 3)
      ? gatedCandidates
      : rawCandidates;

  const lexicalNormalized = normalize(
    candidatePool.map((candidate) => candidate.lexicalScore),
  );
  const vectorNormalized = normalize(
    candidatePool.map((candidate) => candidate.vectorScore),
  );

  const candidates = candidatePool.map((candidate, index) => {
    const importance = Number(candidate.document.importance ?? 0.5);
    const typeScore = typeRelevance(candidate.document.type, intent);
    const timeframeScore = timeframeRelevance(
      candidate.document,
      queryTimeframe,
      intent,
    );
    const targetScore = targetRelevance(
      query,
      candidate.document,
      intent,
    );
    const genericPenalty = metadataPenalty(
      candidate.document,
      intent,
    );

    const score = Math.max(
      0,
      LEXICAL_WEIGHT * (lexicalNormalized[index] ?? 0) +
        VECTOR_WEIGHT * (vectorNormalized[index] ?? 0) +
        IMPORTANCE_WEIGHT * importance +
        TYPE_WEIGHT * typeScore +
        TIMEFRAME_WEIGHT * timeframeScore +
        TARGET_WEIGHT * targetScore -
        genericPenalty,
    );

    return {
      id: candidate.id,
      score,
      lexicalScore: candidate.lexicalScore,
      vectorScore: candidate.vectorScore,
      document: candidate.document,
    };
  });

  const normalizedFinalScores = normalize(
    candidates.map((candidate) => candidate.score),
  );

  return candidates
    .map((candidate, index) => ({
      id: candidate.id,
      score: normalizedFinalScores[index] ?? candidate.score,
      lexicalScore: candidate.lexicalScore,
      vectorScore: candidate.vectorScore,
      document: {
        ...candidate.document,
        embedding: undefined,
      } as unknown as ResearchAtom,
    }))
    .sort((a, b) => b.score - a.score)
    .slice(0, limit);
}
