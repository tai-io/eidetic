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

// --- Graph types ---

export type NodeType =
  | 'file'
  | 'function'
  | 'class'
  | 'module'
  | 'decision'
  | 'convention'
  | 'constraint'
  | 'project';

export type RelationType =
  | 'imports'
  | 'calls'
  | 'depends_on'
  | 'contains'
  | 'motivates'
  | 'contradicts'
  | 'supersedes'
  | 'applies_to'
  | 'related_to';

export interface GraphNode {
  id: string;
  name: string;
  type: NodeType;
  project: string;
  metadata?: Record<string, unknown>;
  created_at: string;
  updated_at: string;
}

export interface GraphEdge {
  id: string;
  sourceId: string;
  targetId: string;
  relationship: RelationType;
  project: string;
  metadata?: Record<string, unknown>;
  created_at: string;
}

export interface GraphTriple {
  source: { name: string; type: NodeType };
  relationship: RelationType;
  target: { name: string; type: NodeType };
}

export interface GraphRelation {
  source: string;
  relationship: string;
  target: string;
}

export interface MemorySearchResult {
  memories: MemoryItem[];
  relations?: GraphRelation[];
}

// --- Consolidation output ---

export interface ConsolidationResult {
  memories: ExtractedFact[];
  graph: GraphTriple[];
}

// --- VectorDB payload ---

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
