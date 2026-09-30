import { create, insert, search, type AnyOrama } from "@orama/orama";
import { EMBEDDING_DIMENSIONS, embedText, embedTexts } from "./embeddings";
import type { ResearchAtom, RetrievedEvidence } from "./types";

const LEXICAL_WEIGHT = 0.35;
const VECTOR_WEIGHT = 0.50;
const IMPORTANCE_WEIGHT = 0.15;

export type RetrievalIndex = AnyOrama;

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

export async function buildRetrievalIndex(atoms: ResearchAtom[], onProgress?: (progress: number) => void) {
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

export async function searchRetrievalIndex(
  db: RetrievalIndex,
  query: string,
  options?: { limit?: number; symbol?: string; type?: ResearchAtom["type"] },
): Promise<RetrievedEvidence[]> {
  const limit = options?.limit ?? 6;
  const where: Record<string, unknown> = {};
  if (options?.symbol) where.symbol = options.symbol;
  if (options?.type) where.type = options.type;

  const lexical =await search(db, {
    term: query,
    properties: ["title", "text", "source", "symbol"],
    limit: Math.max(12, limit * 3),
    where: Object.keys(where).length ? where : undefined,
  });

  const queryEmbedding = await embedText(query);
  const vector = await search(db, {
    mode: "vector",
    vector: { value: queryEmbedding, property: "embedding" },
    similarity: 0,
    limit: Math.max(12, limit * 3),
    where: Object.keys(where).length ? where : undefined,
  });

  const lexicalMap = new Map(lexical.hits.map((hit) => [String(hit.id), hit.score]));
  const vectorMap = new Map(vector.hits.map((hit) => [String(hit.id), hit.score]));
  const allIds = new Set([...lexicalMap.keys(), ...vectorMap.keys()]);

  const candidates = [...allIds].map((id) => {
    const hit = lexical.hits.find((item) => String(item.id) === id) ?? vector.hits.find((item) => String(item.id) === id);
    const document = hit!.document as ResearchAtom & { embedding: number[] };
    const lexicalScore = lexicalMap.get(id) ?? 0;
    const vectorScore = vectorMap.get(id) ?? 0;
    const importance = Number(document.importance ?? 0.5);
    return {
      id,
      score: LEXICAL_WEIGHT * lexicalScore + VECTOR_WEIGHT * vectorScore + IMPORTANCE_WEIGHT * importance,
      lexicalScore,
      vectorScore,
      document,
    };
  });

  const normalizedScores = normalize(candidates.map((candidate) => candidate.score));

  return candidates.map((candidate, index) => ({
    id: candidate.id,
    score: normalizedScores[index] ?? candidate.score,
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
