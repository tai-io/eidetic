/**
 * Query-keyed memory database backed by SQLite.
 *
 * Stores user queries with their embedding vectors, and facts grouped under each query.
 * Search is done by cosine similarity against query vectors, not individual facts.
 */

import { mkdirSync } from 'node:fs';
import path from 'node:path';
import Database from 'better-sqlite3';
import type { QueryRecord, FactRecord, QuerySearchHit, QueryWithFacts, MemoryKind } from './types.js';

// --- Vector helpers (reused from old sqlite-memorydb.ts) ---

export function vectorToBlob(vector: number[]): Buffer {
  const buf = Buffer.alloc(vector.length * 4);
  for (let i = 0; i < vector.length; i++) {
    buf.writeFloatLE(vector[i], i * 4);
  }
  return buf;
}

export function blobToVector(blob: Buffer): number[] {
  const count = blob.length / 4;
  const vector: number[] = new Array(count);
  for (let i = 0; i < count; i++) {
    vector[i] = blob.readFloatLE(i * 4);
  }
  return vector;
}

export function cosineSimilarity(a: number[], b: number[]): number {
  if (a.length !== b.length || a.length === 0) return 0;
  let dot = 0;
  let normA = 0;
  let normB = 0;
  for (let i = 0; i < a.length; i++) {
    dot += a[i] * b[i];
    normA += a[i] * a[i];
    normB += b[i] * b[i];
  }
  const denom = Math.sqrt(normA) * Math.sqrt(normB);
  return denom === 0 ? 0 : dot / denom;
}

// --- Database types for row mapping ---

interface QueryRow {
  id: string;
  query_text: string;
  query_vector: Buffer;
  session_id: string;
  project: string;
  created_at: string;
}

interface FactRow {
  id: string;
  query_id: string;
  fact_text: string;
  kind: string;
  created_at: string;
}

const RECENCY_HALF_LIFE_DAYS = 30;

export class QueryMemoryDB {
  private db: Database.Database;

  constructor(dbPath: string) {
    mkdirSync(path.dirname(dbPath), { recursive: true });
    this.db = new Database(dbPath);
    this.db.pragma('journal_mode = WAL');
    this.db.pragma('foreign_keys = ON');
    this.init();
  }

  private init(): void {
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS queries (
        id TEXT PRIMARY KEY,
        query_text TEXT NOT NULL,
        query_vector BLOB NOT NULL,
        session_id TEXT NOT NULL,
        project TEXT NOT NULL DEFAULT 'global',
        created_at TEXT NOT NULL
      );

      CREATE TABLE IF NOT EXISTS facts (
        id TEXT PRIMARY KEY,
        query_id TEXT NOT NULL REFERENCES queries(id) ON DELETE CASCADE,
        fact_text TEXT NOT NULL,
        kind TEXT NOT NULL,
        created_at TEXT NOT NULL
      );

      CREATE INDEX IF NOT EXISTS idx_queries_project ON queries(project);
      CREATE INDEX IF NOT EXISTS idx_facts_query ON facts(query_id);
    `);
  }

  addQueryWithFacts(query: Omit<QueryRecord, 'query_vector'> & { query_vector: number[] }, facts: Omit<FactRecord, 'query_id'>[]): void {
    const insertQuery = this.db.prepare(
      'INSERT INTO queries (id, query_text, query_vector, session_id, project, created_at) VALUES (?, ?, ?, ?, ?, ?)',
    );
    const insertFact = this.db.prepare(
      'INSERT INTO facts (id, query_id, fact_text, kind, created_at) VALUES (?, ?, ?, ?, ?)',
    );

    const vectorBlob = vectorToBlob(query.query_vector);

    const tx = this.db.transaction(() => {
      insertQuery.run(query.id, query.query_text, vectorBlob, query.session_id, query.project, query.created_at);
      for (const fact of facts) {
        insertFact.run(fact.id, query.id, fact.fact_text, fact.kind, fact.created_at);
      }
    });
    tx();
  }

  addFactsToQuery(queryId: string, facts: Omit<FactRecord, 'query_id'>[]): void {
    const insertFact = this.db.prepare(
      'INSERT INTO facts (id, query_id, fact_text, kind, created_at) VALUES (?, ?, ?, ?, ?)',
    );

    const tx = this.db.transaction(() => {
      for (const fact of facts) {
        insertFact.run(fact.id, queryId, fact.fact_text, fact.kind, fact.created_at);
      }
    });
    tx();
  }

  searchByQuery(queryVector: number[], project?: string, limit = 10): QuerySearchHit[] {
    const where = project ? 'WHERE project = ?' : '';
    const params = project ? [project] : [];
    const rows = this.db.prepare(`SELECT * FROM queries ${where}`).all(...params) as QueryRow[];

    const now = Date.now();
    const scored: { row: QueryRow; score: number }[] = [];

    for (const row of rows) {
      const storedVector = blobToVector(row.query_vector);
      const sim = cosineSimilarity(queryVector, storedVector);
      const ageDays = (now - new Date(row.created_at).getTime()) / (1000 * 60 * 60 * 24);
      const recencyWeight = Math.exp(-ageDays / RECENCY_HALF_LIFE_DAYS);
      const finalScore = sim * recencyWeight;
      scored.push({ row, score: finalScore });
    }

    scored.sort((a, b) => b.score - a.score);
    const topQueries = scored.slice(0, limit);

    return topQueries.map(({ row, score }) => ({
      query: this.rowToQueryRecord(row),
      facts: this.getFactsForQuery(row.id),
      score,
    }));
  }

  getFactsForQuery(queryId: string): FactRecord[] {
    const rows = this.db.prepare('SELECT * FROM facts WHERE query_id = ? ORDER BY created_at').all(queryId) as FactRow[];
    return rows.map((row) => this.rowToFactRecord(row));
  }

  getQueryById(queryId: string): QueryRecord | null {
    const row = this.db.prepare('SELECT * FROM queries WHERE id = ?').get(queryId) as QueryRow | undefined;
    return row ? this.rowToQueryRecord(row) : null;
  }

  findSimilarQuery(queryVector: number[], project: string, threshold = 0.92): { query: QueryRecord; similarity: number } | null {
    const rows = this.db.prepare('SELECT * FROM queries WHERE project = ?').all(project) as QueryRow[];

    let best: { query: QueryRecord; similarity: number } | null = null;

    for (const row of rows) {
      const storedVector = blobToVector(row.query_vector);
      const sim = cosineSimilarity(queryVector, storedVector);
      if (sim >= threshold && (!best || sim > best.similarity)) {
        best = { query: this.rowToQueryRecord(row), similarity: sim };
      }
    }

    return best;
  }

  deleteQuery(queryId: string): boolean {
    const result = this.db.prepare('DELETE FROM queries WHERE id = ?').run(queryId);
    return result.changes > 0;
  }

  listByProject(project: string, limit = 50, kind?: string): QueryWithFacts[] {
    const rows = this.db.prepare(
      'SELECT * FROM queries WHERE project = ? ORDER BY created_at DESC LIMIT ?',
    ).all(project, limit) as QueryRow[];

    return rows.map((row) => {
      let facts: FactRecord[];
      if (kind) {
        const factRows = this.db.prepare(
          'SELECT * FROM facts WHERE query_id = ? AND kind = ? ORDER BY created_at',
        ).all(row.id, kind) as FactRow[];
        facts = factRows.map((r) => this.rowToFactRecord(r));
      } else {
        facts = this.getFactsForQuery(row.id);
      }
      return { query: this.rowToQueryRecord(row), facts };
    }).filter((qf) => qf.facts.length > 0);
  }

  listAll(limit = 100): QueryWithFacts[] {
    const rows = this.db.prepare(
      'SELECT * FROM queries ORDER BY created_at DESC LIMIT ?',
    ).all(limit) as QueryRow[];

    return rows.map((row) => ({
      query: this.rowToQueryRecord(row),
      facts: this.getFactsForQuery(row.id),
    }));
  }

  queryCount(project?: string): number {
    if (project) {
      const row = this.db.prepare('SELECT COUNT(*) as cnt FROM queries WHERE project = ?').get(project) as { cnt: number };
      return row.cnt;
    }
    const row = this.db.prepare('SELECT COUNT(*) as cnt FROM queries').get() as { cnt: number };
    return row.cnt;
  }

  close(): void {
    this.db.close();
  }

  private rowToQueryRecord(row: QueryRow): QueryRecord {
    return {
      id: row.id,
      query_text: row.query_text,
      query_vector: blobToVector(row.query_vector),
      session_id: row.session_id,
      project: row.project,
      created_at: row.created_at,
    };
  }

  private rowToFactRecord(row: FactRow): FactRecord {
    return {
      id: row.id,
      query_id: row.query_id,
      fact_text: row.fact_text,
      kind: row.kind as MemoryKind,
      created_at: row.created_at,
    };
  }
}
