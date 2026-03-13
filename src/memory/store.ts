/**
 * Query-keyed MemoryStore.
 *
 * Stores memories as query→facts groups. Each user query is embedded once;
 * facts are plain text grouped under their query. Dedup is done by cosine
 * similarity on query vectors (≥0.92 = merge facts into existing group).
 */

import { randomUUID } from 'node:crypto';
import type { Embedding } from '../embedding/types.js';
import type {
  MemoryAction,
  ExtractedFact,
  QuerySearchHit,
  QueryWithFacts,
  MemoryItem,
} from './types.js';
import { QueryMemoryDB } from './query-memorydb.js';
import { MemoryHistory } from './history.js';

const DEDUP_THRESHOLD = 0.92;

export class MemoryStore {
  constructor(
    private embedding: Embedding,
    private memorydb: QueryMemoryDB,
    private history: MemoryHistory,
  ) {}

  /**
   * Add a query with its extracted facts.
   * If a semantically similar query exists (cosine ≥ 0.92), merge facts into it.
   */
  async addQueryWithFacts(
    queryText: string,
    facts: ExtractedFact[],
    sessionId: string,
    project = 'global',
  ): Promise<MemoryAction> {
    if (facts.length === 0) {
      return { event: 'ADD', queryId: '', query: queryText, factsAdded: 0, project };
    }

    const queryVector = await this.embedding.embed(queryText);
    const now = new Date().toISOString();

    // Check for duplicate query (cosine similarity ≥ threshold)
    const existing = this.memorydb.findSimilarQuery(queryVector, project, DEDUP_THRESHOLD);

    if (existing) {
      // Merge: add only facts that aren't already present (text dedup)
      const existingFacts = this.memorydb.getFactsForQuery(existing.query.id);
      const existingTexts = new Set(existingFacts.map((f) => f.fact_text.toLowerCase().trim()));

      const newFacts = facts
        .filter((f) => !existingTexts.has(f.fact.toLowerCase().trim()))
        .map((f) => ({
          id: randomUUID(),
          fact_text: f.fact,
          kind: f.kind,
          created_at: now,
        }));

      if (newFacts.length > 0) {
        this.memorydb.addFactsToQuery(existing.query.id, newFacts);
        this.history.log(
          existing.query.id,
          'MERGE',
          queryText,
          existing.query.query_text,
          'merge',
          now,
        );
      }

      return {
        event: 'MERGE',
        queryId: existing.query.id,
        query: existing.query.query_text,
        factsAdded: newFacts.length,
        project,
        mergedInto: existing.query.id,
      };
    }

    // New query group
    const queryId = randomUUID();
    const factRecords = facts.map((f) => ({
      id: randomUUID(),
      fact_text: f.fact,
      kind: f.kind,
      created_at: now,
    }));

    this.memorydb.addQueryWithFacts(
      {
        id: queryId,
        query_text: queryText,
        query_vector: queryVector,
        session_id: sessionId,
        project,
        created_at: now,
      },
      factRecords,
    );

    this.history.log(queryId, 'ADD', queryText, null, 'add', now);

    return {
      event: 'ADD',
      queryId,
      query: queryText,
      factsAdded: facts.length,
      project,
    };
  }

  /**
   * Legacy addMemory interface — wraps addQueryWithFacts for backward compatibility.
   * The first fact's text is used as the query text.
   * `source` is used as session identifier for provenance tracking.
   */
  async addMemory(
    facts: ExtractedFact[],
    sessionId?: string,
    project = 'global',
  ): Promise<MemoryAction[]> {
    if (facts.length === 0) return [];

    // Group all facts under a synthetic query derived from the first fact
    const queryText = facts[0].fact;
    const action = await this.addQueryWithFacts(queryText, facts, sessionId ?? 'unknown', project);
    return [action];
  }

  /**
   * Search memories by embedding the query and finding similar stored queries.
   * Returns flattened MemoryItem[] for backward compatibility.
   */
  async searchMemory(
    query: string,
    limit = 10,
    kind?: string,
    project?: string,
  ): Promise<MemoryItem[]> {
    const queryVector = await this.embedding.embed(query);

    // Search project-specific queries first, then global
    const hits: QuerySearchHit[] = [];

    if (project && project !== 'global') {
      const projectHits = this.memorydb.searchByQuery(queryVector, project, limit);
      // Apply project boost
      for (const hit of projectHits) {
        hit.score *= 1.5;
      }
      hits.push(...projectHits);
    }

    const globalHits = this.memorydb.searchByQuery(queryVector, 'global', limit);
    hits.push(...globalHits);

    // Sort by score descending, dedup by query id
    const seen = new Set<string>();
    const sorted = hits
      .filter((h) => {
        if (seen.has(h.query.id)) return false;
        seen.add(h.query.id);
        return true;
      })
      .sort((a, b) => b.score - a.score);

    // Flatten to MemoryItem[], filtering by kind if requested
    const items: MemoryItem[] = [];
    for (const hit of sorted) {
      for (const fact of hit.facts) {
        if (kind && fact.kind !== kind) continue;
        items.push({
          id: fact.id,
          memory: fact.fact_text,
          kind: fact.kind,
          source: hit.query.query_text,
          project: hit.query.project,
          created_at: fact.created_at,
        });
        if (items.length >= limit) break;
      }
      if (items.length >= limit) break;
    }

    return items;
  }

  /**
   * Search and return raw query hits (for tools that want grouped output).
   */
  async searchQueryHits(query: string, limit = 10, project?: string): Promise<QuerySearchHit[]> {
    const queryVector = await this.embedding.embed(query);

    const hits: QuerySearchHit[] = [];

    if (project && project !== 'global') {
      const projectHits = this.memorydb.searchByQuery(queryVector, project, limit);
      for (const hit of projectHits) {
        hit.score *= 1.5;
      }
      hits.push(...projectHits);
    }

    const globalHits = this.memorydb.searchByQuery(queryVector, 'global', limit);
    hits.push(...globalHits);

    const seen = new Set<string>();
    return hits
      .filter((h) => {
        if (seen.has(h.query.id)) return false;
        seen.add(h.query.id);
        return true;
      })
      .sort((a, b) => b.score - a.score)
      .slice(0, limit);
  }

  listMemories(kind?: string, limit = 50, project?: string): QueryWithFacts[] {
    if (project) {
      return this.memorydb.listByProject(project, limit, kind);
    }
    const raw = this.memorydb.listAll(limit);
    if (!kind) return raw;
    return raw
      .map((qf) => ({ ...qf, facts: qf.facts.filter((f) => f.kind === kind) }))
      .filter((qf) => qf.facts.length > 0);
  }

  deleteMemory(queryId: string): boolean {
    const query = this.memorydb.getQueryById(queryId);
    if (!query) return false;

    const deleted = this.memorydb.deleteQuery(queryId);
    if (deleted) {
      this.history.log(queryId, 'DELETE', null, query.query_text);
    }
    return deleted;
  }

  getHistory(memoryId: string) {
    return this.history.getHistory(memoryId);
  }
}
