export type ResearchAtomType =
  | "technical"
  | "fundamental"
  | "strategy"
  | "market"
  | "research";

export type ResearchAtom = {
  id: string;
  symbol: string;
  type: ResearchAtomType;
  title: string;
  text: string;
  source: string;
  sourceUrl?: string | null;
  timestamp?: string | null;
  timeframe?: string | null;
  exchange?: string | null;
  market?: string | null;
  importance: number;
};

export type RetrievedEvidence = {
  id: string;
  score: number;
  lexicalScore: number;
  vectorScore: number;
  document: ResearchAtom;
};

export type ResearchContextInput = {
  command?: string;
  market_snapshot?: Record<string, unknown> | null;
  fundamentals?: Record<string, unknown> | null;
  strategy_evidence?: Record<string, unknown> | null;
  research?: Array<{
    title?: string;
    text?: string;
    url?: string | null;
    source?: string;
    published_at?: string | null;
  }>;
};
