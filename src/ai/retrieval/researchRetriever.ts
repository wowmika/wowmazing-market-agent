import { buildEvidenceAtoms } from "./evidenceAtoms";
import { buildRetrievalIndex, searchRetrievalIndex, type RetrievalIndex } from "./oramaIndex";
import type { ResearchAtom, ResearchContextInput, RetrievedEvidence } from "./types";

export type ResearchRetriever = {
  db: RetrievalIndex;
  atoms: ResearchAtom[];
  runtime: "webgpu" | "wasm";
  fallbackUsed: boolean;
  search: (query: string, options?: { limit?: number; symbol?: string; type?: ResearchAtom["type"] }) => Promise<RetrievedEvidence[]>;
};

export async function createResearchRetriever(context: ResearchContextInput, onProgress?: (progress: number) => void): Promise<ResearchRetriever> {
  const atoms = buildEvidenceAtoms(context);
  const result = await buildRetrievalIndex(atoms, onProgress);
  return {
    db: result.db,
    atoms,
    runtime: result.embeddingRuntime,
    fallbackUsed: result.embeddingFallbackUsed,
    search: (query, options) => searchRetrievalIndex(result.db, query, options),
  };
}
