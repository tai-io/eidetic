import type { EmbeddingVector } from '../embedding/types.js';

export interface CodeDocument {
  id: string;
  content: string;
  vector: EmbeddingVector;
  relativePath: string;
  startLine: number;
  endLine: number;
  fileExtension: string;
  language: string;
  fileCategory?: string;
  symbolName?: string;
  symbolKind?: string;
  symbolSignature?: string;
  parentSymbol?: string;
}

export interface SymbolEntry {
  name: string;
  kind: string;
  relativePath: string;
  startLine: number;
  signature?: string;
  parentName?: string;
}

export interface HybridSearchParams {
  queryVector: EmbeddingVector;
  queryText: string;
  limit: number;
  extensionFilter?: string[];
}

export interface SearchResult {
  content: string;
  relativePath: string;
  startLine: number;
  endLine: number;
  fileExtension: string;
  language: string;
  score: number;
  fileCategory?: string;
}

export interface VectorDB {
  createCollection(name: string, dimension: number): Promise<void>;
  hasCollection(name: string): Promise<boolean>;
  dropCollection(name: string): Promise<void>;
  insert(name: string, documents: CodeDocument[]): Promise<void>;
  search(name: string, params: HybridSearchParams): Promise<SearchResult[]>;
  deleteByPath(name: string, relativePath: string): Promise<void>;
  deleteByFilter(name: string, filter: Record<string, unknown>): Promise<void>;
  getById(
    name: string,
    id: string,
  ): Promise<{ payload: Record<string, unknown>; vector: number[] } | null>;
  updatePoint(
    name: string,
    id: string,
    vector: number[],
    payload: Record<string, unknown>,
  ): Promise<void>;
  listSymbols(name: string): Promise<SymbolEntry[]>;
  scrollAll(
    name: string,
  ): Promise<{ id: string | number; vector: number[]; payload: Record<string, unknown> }[]>;
}
