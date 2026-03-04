import Database from 'better-sqlite3';
import { mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
import { getRaptorDbPath } from '../paths.js';

let db: Database.Database | null = null;

function getDb(): Database.Database {
  if (db) return db;
  const dbPath = getRaptorDbPath();
  mkdirSync(dirname(dbPath), { recursive: true });
  db = new Database(dbPath);
  db.pragma('journal_mode = WAL');
  db.exec(`
    CREATE TABLE IF NOT EXISTS raptor_clusters (
      cluster_hash TEXT PRIMARY KEY,
      summary TEXT NOT NULL,
      project TEXT NOT NULL,
      level INTEGER NOT NULL DEFAULT 0,
      updated_at TEXT NOT NULL
    )
  `);
  return db;
}

export function getCachedSummary(clusterHash: string): string | null {
  const row = getDb()
    .prepare('SELECT summary FROM raptor_clusters WHERE cluster_hash = ?')
    .get(clusterHash) as { summary: string } | undefined;
  return row?.summary ?? null;
}

export function setCachedSummary(
  clusterHash: string,
  summary: string,
  project: string,
  level = 0,
): void {
  getDb()
    .prepare(
      'INSERT OR REPLACE INTO raptor_clusters (cluster_hash, summary, project, level, updated_at) VALUES (?, ?, ?, ?, ?)',
    )
    .run(clusterHash, summary, project, level, new Date().toISOString());
}

export function clearProjectCache(project: string): void {
  getDb().prepare('DELETE FROM raptor_clusters WHERE project = ?').run(project);
}

/** Reset the module-level DB connection (for testing). */
export function _resetDb(): void {
  if (db) {
    db.close();
    db = null;
  }
}
