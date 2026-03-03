import Database from 'better-sqlite3';
import fs from 'node:fs';
import path from 'node:path';
import { mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
import { pathToCollectionName, getSnapshotDbPath, getSnapshotDir } from '../paths.js';
import type { FileSnapshot } from './sync.js';

let db: Database.Database | null = null;

function getDb(): Database.Database {
  if (db) return db;
  const dbPath = getSnapshotDbPath();
  mkdirSync(dirname(dbPath), { recursive: true });
  db = new Database(dbPath);
  db.pragma('journal_mode = WAL');
  db.exec(`
    CREATE TABLE IF NOT EXISTS snapshots (
      collection_name TEXT PRIMARY KEY,
      data TEXT NOT NULL,
      updated_at TEXT NOT NULL
    )
  `);
  migrateJsonSnapshots(db);
  return db;
}

function migrateJsonSnapshots(database: Database.Database): void {
  const snapshotDir = getSnapshotDir();
  try {
    if (!fs.existsSync(snapshotDir)) return;
    const files = fs.readdirSync(snapshotDir).filter((f) => f.endsWith('.json'));
    if (files.length === 0) return;

    const insert = database.prepare(
      'INSERT OR IGNORE INTO snapshots (collection_name, data, updated_at) VALUES (?, ?, ?)',
    );
    let migrated = 0;
    for (const file of files) {
      const collectionName = file.replace(/\.json$/, '');
      try {
        const raw = fs.readFileSync(path.join(snapshotDir, file), 'utf-8');
        JSON.parse(raw); // validate
        insert.run(collectionName, raw, new Date().toISOString());
        migrated++;
      } catch {
        // skip corrupted files
      }
    }
    if (migrated > 0) {
      console.warn(`Migrated ${migrated} JSON snapshot(s) to SQLite`);
    }
  } catch {
    // migration is best-effort
  }
}

export function loadSnapshot(rootPath: string): FileSnapshot | null {
  const name = pathToCollectionName(rootPath);
  const row = getDb().prepare('SELECT data FROM snapshots WHERE collection_name = ?').get(name) as
    | { data: string }
    | undefined;
  if (!row) return null;
  try {
    return JSON.parse(row.data) as FileSnapshot;
  } catch {
    console.warn(`Corrupted snapshot for ${name}, ignoring`);
    return null;
  }
}

export function saveSnapshot(rootPath: string, snapshot: FileSnapshot): void {
  const name = pathToCollectionName(rootPath);
  getDb()
    .prepare(
      'INSERT OR REPLACE INTO snapshots (collection_name, data, updated_at) VALUES (?, ?, ?)',
    )
    .run(name, JSON.stringify(snapshot), new Date().toISOString());
}

export function deleteSnapshot(rootPath: string): void {
  const name = pathToCollectionName(rootPath);
  getDb().prepare('DELETE FROM snapshots WHERE collection_name = ?').run(name);
}

export function snapshotExists(rootPath: string): boolean {
  const name = pathToCollectionName(rootPath);
  const row = getDb().prepare('SELECT 1 FROM snapshots WHERE collection_name = ?').get(name);
  return row !== undefined;
}

export function listSnapshotCollections(): string[] {
  const rows = getDb().prepare('SELECT collection_name FROM snapshots').all() as {
    collection_name: string;
  }[];
  return rows.map((r) => r.collection_name);
}

export function deleteSnapshotByCollection(collectionName: string): void {
  getDb().prepare('DELETE FROM snapshots WHERE collection_name = ?').run(collectionName);
}

/** Reset the module-level DB connection (for testing). */
export function _resetDb(): void {
  if (db) {
    db.close();
    db = null;
  }
}
