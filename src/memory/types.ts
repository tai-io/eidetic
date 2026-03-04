import type { MemoryKind } from './query-classifier.js';

export type { MemoryKind };

export interface MemoryItem {
  id: string;
  memory: string;
  hash: string;
  kind: MemoryKind;
  source: string;
  project: string;
  access_count: number;
  last_accessed: string;
  supersedes: string | null;
  superseded_by: string | null;
  valid_at: string;
  created_at: string;
  updated_at: string;
}

export type MemoryEvent = 'ADD' | 'UPDATE' | 'DELETE' | 'SUPERSEDE';

export interface MemoryAction {
  event: MemoryEvent;
  id: string;
  memory: string;
  previous?: string;
  kind?: MemoryKind;
  source?: string;
  project?: string;
  supersedes?: string;
}

export interface ReconcileResult {
  action: 'ADD' | 'UPDATE' | 'NONE' | 'SUPERSEDE';
  existingId?: string;
  existingMemory?: string;
}

export interface ExtractedFact {
  fact: string;
  kind: MemoryKind;
  project?: string;
  valid_at?: string;
}

/**
 * @deprecated Use ExtractedFact with `kind` instead. Kept for migration compatibility.
 */
export interface LegacyExtractedFact {
  fact: string;
  category: string;
  project?: string;
}

/**
 * Typed shape of memory payloads stored in VectorDB.
 * Used to safely cast `Record<string, unknown>` from VectorDB.getById().
 */
export interface MemoryPayload {
  content?: string;
  memory?: string;
  hash?: string;
  kind?: string;
  source?: string;
  project?: string;
  language?: string;
  fileExtension?: string;
  category?: string;
  access_count?: number;
  last_accessed?: string;
  supersedes?: string | null;
  superseded_by?: string | null;
  valid_at?: string;
  created_at?: string;
  updated_at?: string;
}
