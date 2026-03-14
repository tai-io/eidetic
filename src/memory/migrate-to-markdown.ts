/**
 * Migrate memories from SQLite (memorystore.db) to markdown files.
 *
 * Reads all queries + facts from the old database, writes markdown files
 * to the memories directory, copies existing vectors into the vector cache
 * (no re-embedding needed), and renames the old database.
 */

import fs from 'node:fs';
import path from 'node:path';
import Database from 'better-sqlite3';
import { mkdirSync } from 'node:fs';

import { serializeMemoryFile } from './markdown-io.js';
import type { MemoryFile } from './markdown-io.js';
import type { MemoryKind } from './types.js';
import { writeFileAtomic } from '../precompact/utils.js';

interface MigrationQueryRow {
  id: string;
  query_text: string;
  query_vector: Buffer;
  session_id: string;
  project: string;
  created_at: string;
}

interface MigrationFactRow {
  id: string;
  query_id: string;
  fact_text: string;
  kind: MemoryKind;
  created_at: string;
}

/**
 * Migrate from SQLite memorystore.db to markdown files + vector cache.
 *
 * No-op if:
 * - oldDbPath doesn't exist
 * - memories directory already has .md files (already migrated)
 */
export function migrateToMarkdown(
  oldDbPath: string,
  memoriesDir: string,
  vectorCachePath: string,
): { migrated: number } | null {
  if (!fs.existsSync(oldDbPath)) return null;

  // Check if already migrated — if markdown files exist, skip
  mkdirSync(memoriesDir, { recursive: true });
  const existingFiles = fs.readdirSync(memoriesDir).filter((f) => f.endsWith('.md'));
  if (existingFiles.length > 0) return null;

  const oldDb = new Database(oldDbPath, { readonly: true });

  // Verify the old DB has the expected schema
  const tables = oldDb.prepare("SELECT name FROM sqlite_master WHERE type='table'").all() as {
    name: string;
  }[];
  const tableNames = new Set(tables.map((t) => t.name));
  if (!tableNames.has('queries') || !tableNames.has('facts')) {
    oldDb.close();
    return null;
  }

  const queries = oldDb.prepare('SELECT * FROM queries').all() as MigrationQueryRow[];
  const allFacts = oldDb
    .prepare('SELECT * FROM facts ORDER BY created_at')
    .all() as MigrationFactRow[];
  oldDb.close();

  // Group facts by query_id
  const factsByQuery = new Map<string, MigrationFactRow[]>();
  for (const fact of allFacts) {
    const existing = factsByQuery.get(fact.query_id);
    if (existing) {
      existing.push(fact);
    } else {
      factsByQuery.set(fact.query_id, [fact]);
    }
  }

  // Set up vector cache
  mkdirSync(path.dirname(vectorCachePath), { recursive: true });
  const cacheDb = new Database(vectorCachePath);
  cacheDb.pragma('journal_mode = WAL');
  cacheDb.exec(`
    CREATE TABLE IF NOT EXISTS query_vectors (
      id TEXT PRIMARY KEY,
      query_vector BLOB NOT NULL,
      project TEXT NOT NULL,
      created_at TEXT NOT NULL,
      file_mtime INTEGER NOT NULL
    );
  `);

  const insertCache = cacheDb.prepare(
    'INSERT OR REPLACE INTO query_vectors (id, query_vector, project, created_at, file_mtime) VALUES (?, ?, ?, ?, ?)',
  );

  let migrated = 0;

  for (const query of queries) {
    const facts = factsByQuery.get(query.id) ?? [];

    const memoryFile: MemoryFile = {
      id: query.id,
      query: query.query_text,
      project: query.project,
      sessionId: query.session_id,
      createdAt: query.created_at,
      facts: facts.map((f) => ({
        kind: f.kind,
        text: f.fact_text,
      })),
    };

    const filePath = path.join(memoriesDir, `${query.id}.md`);
    writeFileAtomic(filePath, serializeMemoryFile(memoryFile));

    // Copy vector directly (no re-embedding needed)
    const mtime = fs.statSync(filePath).mtimeMs;
    insertCache.run(query.id, query.query_vector, query.project, query.created_at, mtime);

    migrated++;
  }

  cacheDb.close();

  // Rename old database to mark as migrated
  const migratedPath = `${oldDbPath}.migrated`;
  fs.renameSync(oldDbPath, migratedPath);

  // Also rename WAL/SHM files if they exist
  for (const suffix of ['-wal', '-shm']) {
    const walPath = `${oldDbPath}${suffix}`;
    if (fs.existsSync(walPath)) {
      fs.renameSync(walPath, `${migratedPath}${suffix}`);
    }
  }

  process.stderr.write(
    `[eidetic] Migrated ${migrated} memories from SQLite to markdown (${memoriesDir})\n`,
  );

  return { migrated };
}
