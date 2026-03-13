import type { MemoryKind } from './query-classifier.js';

export type { MemoryKind };

// --- Query-keyed memory model ---

export interface QueryRecord {
  id: string;
  query_text: string;
  query_vector: number[];
  session_id: string;
  project: string;
  created_at: string;
}

export interface FactRecord {
  id: string;
  query_id: string;
  fact_text: string;
  kind: MemoryKind;
  created_at: string;
}

export interface QueryWithFacts {
  query: QueryRecord;
  facts: FactRecord[];
}

export interface QuerySearchHit {
  query: QueryRecord;
  facts: FactRecord[];
  score: number;
}

// --- Legacy MemoryItem (kept for format compatibility) ---

export interface MemoryItem {
  id: string;
  memory: string;
  kind: MemoryKind;
  source: string;
  project: string;
  created_at: string;
}

export type MemoryEvent = 'ADD' | 'MERGE' | 'DELETE';

export interface MemoryAction {
  event: MemoryEvent;
  queryId: string;
  query: string;
  factsAdded: number;
  project?: string;
  mergedInto?: string;
}

// --- Extraction types (replaces ConsolidationResult) ---

export interface ExtractedFact {
  fact: string;
  kind: MemoryKind;
}

export interface ExtractionGroup {
  query: string;
  facts: ExtractedFact[];
}

export interface ExtractionResult {
  groups: ExtractionGroup[];
}

// --- Buffer types ---

export interface BufferItem {
  id: number;
  session_id: string;
  content: string;
  source: string;
  tool_name: string | null;
  project: string;
  captured_at: string;
}
