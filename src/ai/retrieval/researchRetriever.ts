import { buildEvidenceAtoms } from "./evidenceAtoms";
import {
  buildRetrievalIndex,
  searchRetrievalIndex,
  type QueryIntent,
  type RetrievalIndex,
} from "./oramaIndex";
import type {
  ResearchAtom,
  ResearchContextInput,
  RetrievedEvidence,
} from "./types";

const CACHE_TTL_MS = 5 * 60 * 1000;
const MAX_INDEX_CACHE_ENTRIES = 4;
const MAX_QUERY_CACHE_ENTRIES = 16;

type CacheEntry = {
  key: string;
  db: RetrievalIndex;
  atoms: ResearchAtom[];
  runtime: "webgpu" | "wasm";
  fallbackUsed: boolean;
  createdAt: number;
  queryCache: Map<string, RetrievedEvidence[]>;
};

const indexCache = new Map<string, CacheEntry>();
const buildPromises = new Map<string, Promise<CacheEntry>>();

export type ResearchRetriever = {
  db: RetrievalIndex;
  atoms: ResearchAtom[];
  runtime: "webgpu" | "wasm";
  fallbackUsed: boolean;
  cacheHit: boolean;
  search: (
    query: string,
    options?: {
      limit?: number;
      symbol?: string;
      type?: ResearchAtom["type"];
      intent?: QueryIntent;
    },
  ) => Promise<RetrievedEvidence[]>;
};

function stableFingerprint(atoms: ResearchAtom[]): string {
  const normalized = atoms
    .map((atom) =>
      [
        atom.id,
        atom.symbol,
        atom.type,
        atom.title,
        atom.text,
        atom.source,
        atom.sourceUrl ?? "",
        atom.timeframe ?? "",
        atom.exchange ?? "",
        atom.market ?? "",
        atom.importance.toFixed(4),
      ].join("|")
    )
    .sort()
    .join("||");

  // Small FNV-1a hash: deterministic, fast, and browser-safe.
  let hash = 2166136261;
  for (let i = 0; i < normalized.length; i += 1) {
    hash ^= normalized.charCodeAt(i);
    hash = Math.imul(hash, 16777619);
  }

  return `${atoms.length}-${(hash >>> 0).toString(16)}`;
}

function touchCache(key: string, entry: CacheEntry): void {
  indexCache.delete(key);
  indexCache.set(key, entry);
}

function trimCache(): void {
  while (indexCache.size > MAX_INDEX_CACHE_ENTRIES) {
    const oldestKey = indexCache.keys().next().value as string | undefined;
    if (!oldestKey) break;
    indexCache.delete(oldestKey);
  }
}

function trimQueryCache(entry: CacheEntry): void {
  while (entry.queryCache.size > MAX_QUERY_CACHE_ENTRIES) {
    const oldestKey = entry.queryCache.keys().next().value as
      | string
      | undefined;
    if (!oldestKey) break;
    entry.queryCache.delete(oldestKey);
  }
}

async function getOrBuildEntry(
  atoms: ResearchAtom[],
  key: string,
  onProgress?: (progress: number) => void,
): Promise<{ entry: CacheEntry; cacheHit: boolean }> {
  const now = Date.now();
  const cached = indexCache.get(key);

  if (cached && now - cached.createdAt < CACHE_TTL_MS) {
    touchCache(key, cached);
    return { entry: cached, cacheHit: true };
  }

  if (cached) indexCache.delete(key);

  const existingBuild = buildPromises.get(key);
  if (existingBuild) {
    return {
      entry: await existingBuild,
      cacheHit: true,
    };
  }

  const buildPromise = (async () => {
    const result = await buildRetrievalIndex(atoms, onProgress);
    const entry: CacheEntry = {
      key,
      db: result.db,
      atoms,
      runtime: result.embeddingRuntime,
      fallbackUsed: result.embeddingFallbackUsed,
      createdAt: Date.now(),
      queryCache: new Map(),
    };

    indexCache.set(key, entry);
    trimCache();
    return entry;
  })();

  buildPromises.set(key, buildPromise);

  try {
    return {
      entry: await buildPromise,
      cacheHit: false,
    };
  } finally {
    buildPromises.delete(key);
  }
}

function queryCacheKey(
  query: string,
  options?: {
    limit?: number;
    symbol?: string;
    type?: ResearchAtom["type"];
    intent?: QueryIntent;
  },
): string {
  return JSON.stringify({
    q: query.trim().toLowerCase().replace(/\s+/g, " "),
    limit: options?.limit ?? 6,
    symbol: options?.symbol ?? "",
    type: options?.type ?? "",
    intent: options?.intent ?? "auto",
  });
}

export async function createResearchRetriever(
  context: ResearchContextInput,
  onProgress?: (progress: number) => void,
): Promise<ResearchRetriever> {
  const atoms = buildEvidenceAtoms(context);
  const key = stableFingerprint(atoms);
  const { entry, cacheHit } = await getOrBuildEntry(
    atoms,
    key,
    onProgress,
  );

  return {
    db: entry.db,
    atoms: entry.atoms,
    runtime: entry.runtime,
    fallbackUsed: entry.fallbackUsed,
    cacheHit,
    search: async (query, options) => {
      const cacheKey = queryCacheKey(query, options);
      const cachedResults = entry.queryCache.get(cacheKey);

      if (cachedResults) {
        entry.queryCache.delete(cacheKey);
        entry.queryCache.set(cacheKey, cachedResults);
        return cachedResults;
      }

      const results = await searchRetrievalIndex(
        entry.db,
        query,
        options,
      );

      entry.queryCache.set(cacheKey, results);
      trimQueryCache(entry);

      return results;
    },
  };
}

export function clearResearchRetrieverCache(): void {
  indexCache.clear();
  buildPromises.clear();
}

export function getResearchRetrieverCacheStats() {
  return {
    indexEntries: indexCache.size,
    buildingEntries: buildPromises.size,
    ttlMs: CACHE_TTL_MS,
    maxIndexEntries: MAX_INDEX_CACHE_ENTRIES,
    maxQueryEntries: MAX_QUERY_CACHE_ENTRIES,
  };
}
