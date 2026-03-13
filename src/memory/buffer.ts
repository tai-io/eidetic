import Database from 'better-sqlite3';
import { mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
import type { BufferItem } from './types.js';

export const FLUSH_THRESHOLD = 8;

const STALE_LOCK_MS = 5 * 60 * 1000; // 5 minutes

export class MemoryBuffer {
  private db: Database.Database;

  constructor(dbPath: string) {
    mkdirSync(dirname(dbPath), { recursive: true });
    this.db = new Database(dbPath);
    this.db.pragma('journal_mode = WAL');
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS memory_buffer (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        session_id TEXT NOT NULL,
        content TEXT NOT NULL,
        source TEXT NOT NULL,
        tool_name TEXT,
        project TEXT NOT NULL DEFAULT 'global',
        captured_at TEXT NOT NULL
      );
      CREATE INDEX IF NOT EXISTS idx_buffer_session ON memory_buffer(session_id);

      CREATE TABLE IF NOT EXISTS buffer_sessions (
        session_id TEXT PRIMARY KEY,
        consolidating_since TEXT
      );
    `);
  }

  add(
    sessionId: string,
    content: string,
    source: string,
    toolName: string | null,
    project: string,
  ): void {
    this.db
      .prepare(
        `INSERT INTO memory_buffer (session_id, content, source, tool_name, project, captured_at)
         VALUES (?, ?, ?, ?, ?, ?)`,
      )
      .run(sessionId, content, source, toolName, project, new Date().toISOString());
  }

  count(sessionId: string): number {
    const row = this.db
      .prepare(`SELECT COUNT(*) as cnt FROM memory_buffer WHERE session_id = ?`)
      .get(sessionId) as { cnt: number } | undefined;
    return row?.cnt ?? 0;
  }

  flush(sessionId: string): BufferItem[] {
    return this.db
      .prepare(`SELECT * FROM memory_buffer WHERE session_id = ? ORDER BY id ASC`)
      .all(sessionId) as BufferItem[];
  }

  clear(sessionId: string): void {
    this.db.prepare(`DELETE FROM memory_buffer WHERE session_id = ?`).run(sessionId);
  }

  markConsolidating(sessionId: string): void {
    this.db
      .prepare(
        `INSERT INTO buffer_sessions (session_id, consolidating_since) VALUES (?, ?)
         ON CONFLICT(session_id) DO UPDATE SET consolidating_since = ?`,
      )
      .run(sessionId, new Date().toISOString(), new Date().toISOString());
  }

  isConsolidating(sessionId: string): boolean {
    const row = this.db
      .prepare(`SELECT consolidating_since FROM buffer_sessions WHERE session_id = ?`)
      .get(sessionId) as { consolidating_since: string | null } | undefined;
    if (!row?.consolidating_since) return false;
    const lockAge = Date.now() - new Date(row.consolidating_since).getTime();
    return lockAge < STALE_LOCK_MS;
  }

  clearConsolidating(sessionId: string): void {
    this.db
      .prepare(`UPDATE buffer_sessions SET consolidating_since = NULL WHERE session_id = ?`)
      .run(sessionId);
  }

  /**
   * Remove and return items older than maxAgeMs.
   * Used for stale buffer cleanup at startup and in buffer-runner.
   */
  clearStaleItems(maxAgeMs: number): BufferItem[] {
    const cutoff = new Date(Date.now() - maxAgeMs).toISOString();
    const stale = this.db
      .prepare(`SELECT * FROM memory_buffer WHERE captured_at < ? ORDER BY id ASC`)
      .all(cutoff) as BufferItem[];
    if (stale.length > 0) {
      this.db.prepare(`DELETE FROM memory_buffer WHERE captured_at < ?`).run(cutoff);
    }
    return stale;
  }

  /** Run a raw SQL statement with params. Exposed for testing. */
  rawRun(sql: string, ...params: unknown[]): void {
    this.db.prepare(sql).run(...params);
  }

  close(): void {
    this.db.close();
  }
}
