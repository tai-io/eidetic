/**
 * Interface for query-keyed memory storage backends.
 *
 * Extracted from QueryMemoryDB to allow swapping implementations
 * (e.g., SQLite-backed vs markdown-backed).
 */

import type { QueryRecord, FactRecord, QuerySearchHit, QueryWithFacts } from './types.js';

export interface MemoryDB {
  addQueryWithFacts(
    query: Omit<QueryRecord, 'query_vector'> & { query_vector: number[] },
    facts: Omit<FactRecord, 'query_id'>[],
  ): void;

  addFactsToQuery(queryId: string, facts: Omit<FactRecord, 'query_id'>[]): void;

  replaceFactsForQuery(queryId: string, facts: Omit<FactRecord, 'query_id'>[]): void;

  searchByQuery(queryVector: number[], project?: string, limit?: number): QuerySearchHit[];

  findSimilarQuery(
    queryVector: number[],
    project: string,
    threshold?: number,
  ): { query: QueryRecord; similarity: number } | null;

  getFactsForQuery(queryId: string): FactRecord[];

  getQueryById(queryId: string): QueryRecord | null;

  deleteQuery(queryId: string): boolean;

  listByProject(project: string, limit?: number, kind?: string): QueryWithFacts[];

  listAll(limit?: number): QueryWithFacts[];

  queryCount(project?: string): number;

  close(): void;
}
