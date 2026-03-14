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
  files: string[];
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
  files: string[];
}

export interface ExtractionGroup {
  query: string;
  facts: ExtractedFact[];
}

export interface ExtractionResult {
  groups: ExtractionGroup[];
}

// --- Buffer types ---

export type BufferSource = 'tool-output' | 'file-context' | 'post-tool-extract' | 'user-explicit';

export interface BufferItem {
  id: number;
  session_id: string;
  content: string;
  source: string;
  tool_name: string | null;
  project: string;
  file_paths: string | null;
  raw_output: string | null;
  captured_at: string;
}
