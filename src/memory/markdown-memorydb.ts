/**
 * Markdown-backed memory database.
 *
 * Markdown files are the source of truth; SQLite is a rebuildable vector cache
 * used only for semantic search. Users can read, edit, or delete `.md` files directly.
 *
 * Storage: ~/.eidetic/memories/<project>/<slug>.md  (slug derived from query text)
 * Cache:   ~/.eidetic/memories/<project>/.vector-cache.db
 */

import fs from 'node:fs';
import path from 'node:path';
import { mkdirSync, readdirSync, statSync, unlinkSync } from 'node:fs';
import Database from 'better-sqlite3';

import type { MemoryDB } from './memorydb.js';
import type { QueryRecord, FactRecord, QuerySearchHit, QueryWithFacts } from './types.js';
import { MemoryError } from '../errors.js';
import { vectorToBlob, blobToVector, cosineSimilarity } from './vector-utils.js';
import { parseMemoryFile, serializeMemoryFile } from './markdown-io.js';
import type { MemoryFile, MemoryFileFact } from './markdown-io.js';
import { writeFileAtomic } from '../precompact/utils.js';
import { slugify, resolveSlugCollision } from './slug.js';
import { migrateToSlugs } from './migrate-to-slugs.js';
import { ensureObsidianVault } from './obsidian.js';

const RECENCY_HALF_LIFE_DAYS = 30;
const STALENESS_CHECK_INTERVAL_MS = 5000;

interface VectorCacheRow {
  id: string;
  query_vector: Buffer;
  project: string;
  created_at: string;
  file_mtime: number;
}

export class MarkdownMemoryDB implements MemoryDB {
  private cacheDb: Database.Database;
  private lastStalenessCheck = 0;
  private idToPath = new Map<string, string>();
  private slugsInUse = new Set<string>();

  constructor(
    private memoriesDir: string,
    cachePath: string,
  ) {
    mkdirSync(memoriesDir, { recursive: true });
    mkdirSync(path.dirname(cachePath), { recursive: true });
    this.cacheDb = new Database(cachePath);
    this.cacheDb.pragma('journal_mode = WAL');
    this.initCache();
    migrateToSlugs(memoriesDir);
    this.buildIdToPathMap();
    ensureObsidianVault(path.dirname(memoriesDir));
  }

  private initCache(): void {
    this.cacheDb.exec(`
      CREATE TABLE IF NOT EXISTS query_vectors (
        id TEXT PRIMARY KEY,
        query_vector BLOB NOT NULL,
        project TEXT NOT NULL,
        created_at TEXT NOT NULL,
        file_mtime INTEGER NOT NULL
      );
    `);
  }

  /**
   * Scan all .md files, parse frontmatter, populate idToPath and slugsInUse maps.
   */
  private buildIdToPathMap(): void {
    this.idToPath.clear();
    this.slugsInUse.clear();

    for (const fileName of this.listMdFiles()) {
      const filePath = path.join(this.memoriesDir, fileName);
      const slug = path.basename(fileName, '.md');
      this.slugsInUse.add(slug);

      try {
        const content = fs.readFileSync(filePath, 'utf-8');
        const parsed = parseMemoryFile(content);
        if (parsed) {
          this.idToPath.set(parsed.id, filePath);
        }
      } catch {
        // Skip unreadable files
      }
    }
  }

  // --- Write operations (markdown is source of truth) ---

  addQueryWithFacts(
    query: Omit<QueryRecord, 'query_vector'> & { query_vector: number[] },
    facts: Omit<FactRecord, 'query_id'>[],
  ): void {
    const factEntries = facts.map((f) => ({ kind: f.kind, text: f.fact_text }));
    const memoryFile: MemoryFile = {
      id: query.id,
      query: query.query_text,
      project: query.project,
      sessionId: query.session_id,
      createdAt: query.created_at,
      facts: factEntries,
      tags: [...new Set(factEntries.map((f) => f.kind))].sort(),
      aliases: [query.query_text],
    };

    const baseSlug = slugify(query.query_text);
    const slug = resolveSlugCollision(baseSlug, this.slugsInUse);
    this.slugsInUse.add(slug);

    const filePath = path.join(this.memoriesDir, `${slug}.md`);
    writeFileAtomic(filePath, serializeMemoryFile(memoryFile));
    this.idToPath.set(query.id, filePath);

    const mtime = statSync(filePath).mtimeMs;
    this.upsertCacheEntry(query.id, query.query_vector, query.project, query.created_at, mtime);
  }

  addFactsToQuery(queryId: string, facts: Omit<FactRecord, 'query_id'>[]): void {
    const filePath = this.getFilePath(queryId);
    const content = fs.readFileSync(filePath, 'utf-8');
    const memoryFile = parseMemoryFile(content);
    if (!memoryFile) {
      throw new MemoryError(`Cannot add facts: memory file for ${queryId} is missing or corrupt`);
    }

    for (const fact of facts) {
      memoryFile.facts.push({ kind: fact.kind, text: fact.fact_text });
    }

    writeFileAtomic(filePath, serializeMemoryFile(memoryFile));

    // Update mtime in cache
    const mtime = statSync(filePath).mtimeMs;
    this.cacheDb
      .prepare('UPDATE query_vectors SET file_mtime = ? WHERE id = ?')
      .run(mtime, queryId);
  }

  // --- Search operations (use vector cache) ---

  searchByQuery(queryVector: number[], project?: string, limit = 10): QuerySearchHit[] {
    this.refreshStaleCacheEntries();

    const where = project ? 'WHERE project = ?' : '';
    const params = project ? [project] : [];
    const rows = this.cacheDb
      .prepare(`SELECT * FROM query_vectors ${where}`)
      .all(...params) as VectorCacheRow[];

    const now = Date.now();
    const scored: { row: VectorCacheRow; score: number }[] = [];

    for (const row of rows) {
      const storedVector = blobToVector(row.query_vector);
      const sim = cosineSimilarity(queryVector, storedVector);
      const ageDays = (now - new Date(row.created_at).getTime()) / (1000 * 60 * 60 * 24);
      const recencyWeight = Math.exp(-ageDays / RECENCY_HALF_LIFE_DAYS);
      scored.push({ row, score: sim * recencyWeight });
    }

    scored.sort((a, b) => b.score - a.score);
    const topQueries = scored.slice(0, limit);

    const results: QuerySearchHit[] = [];
    for (const { row, score } of topQueries) {
      const memoryFile = this.loadMemoryFile(row.id);
      if (!memoryFile) continue; // File deleted between cache check and read
      results.push({
        query: this.memoryFileToQueryRecord(memoryFile, blobToVector(row.query_vector)),
        facts: this.memoryFileToFactRecords(memoryFile),
        score,
      });
    }
    return results;
  }

  findSimilarQuery(
    queryVector: number[],
    project: string,
    threshold = 0.92,
  ): { query: QueryRecord; similarity: number } | null {
    const rows = this.cacheDb
      .prepare('SELECT * FROM query_vectors WHERE project = ?')
      .all(project) as VectorCacheRow[];

    let best: { query: QueryRecord; similarity: number } | null = null;

    for (const row of rows) {
      const storedVector = blobToVector(row.query_vector);
      const sim = cosineSimilarity(queryVector, storedVector);
      if (sim >= threshold && (!best || sim > best.similarity)) {
        const memoryFile = this.loadMemoryFile(row.id);
        if (memoryFile) {
          best = {
            query: this.memoryFileToQueryRecord(memoryFile, storedVector),
            similarity: sim,
          };
        }
      }
    }

    return best;
  }

  // --- Read operations (from markdown files) ---

  getFactsForQuery(queryId: string): FactRecord[] {
    const memoryFile = this.loadMemoryFile(queryId);
    if (!memoryFile) return [];
    return this.memoryFileToFactRecords(memoryFile);
  }

  getQueryById(queryId: string): QueryRecord | null {
    const memoryFile = this.loadMemoryFile(queryId);
    if (!memoryFile) return null;

    const vector = this.tryGetCachedVector(queryId);
    if (!vector) return null;
    return this.memoryFileToQueryRecord(memoryFile, vector);
  }

  deleteQuery(queryId: string): boolean {
    const filePath = this.idToPath.get(queryId);
    if (!filePath || !fs.existsSync(filePath)) return false;

    const slug = path.basename(filePath, '.md');
    unlinkSync(filePath);
    this.cacheDb.prepare('DELETE FROM query_vectors WHERE id = ?').run(queryId);
    this.idToPath.delete(queryId);
    this.slugsInUse.delete(slug);
    return true;
  }

  listByProject(project: string, limit = 50, kind?: string): QueryWithFacts[] {
    const allFiles = this.loadAllMemoryFiles();
    const projectFiles = allFiles
      .filter((f) => f.project === project)
      .sort((a, b) => b.createdAt.localeCompare(a.createdAt))
      .slice(0, limit);

    const results: QueryWithFacts[] = [];
    for (const memoryFile of projectFiles) {
      const vector = this.tryGetCachedVector(memoryFile.id);
      if (!vector) continue;
      let facts = this.memoryFileToFactRecords(memoryFile);
      if (kind) {
        facts = facts.filter((f) => f.kind === kind);
      }
      if (facts.length > 0) {
        results.push({
          query: this.memoryFileToQueryRecord(memoryFile, vector),
          facts,
        });
      }
    }
    return results;
  }

  listAll(limit = 100): QueryWithFacts[] {
    const allFiles = this.loadAllMemoryFiles();
    const sorted = allFiles.sort((a, b) => b.createdAt.localeCompare(a.createdAt)).slice(0, limit);

    const results: QueryWithFacts[] = [];
    for (const memoryFile of sorted) {
      const vector = this.tryGetCachedVector(memoryFile.id);
      if (!vector) continue;
      results.push({
        query: this.memoryFileToQueryRecord(memoryFile, vector),
        facts: this.memoryFileToFactRecords(memoryFile),
      });
    }
    return results;
  }

  queryCount(project?: string): number {
    if (project) {
      const allFiles = this.loadAllMemoryFiles();
      return allFiles.filter((f) => f.project === project).length;
    }
    return this.loadAllMemoryFiles().length;
  }

  close(): void {
    this.cacheDb.close();
  }

  // --- Cache management ---

  /**
   * Refresh stale cache entries by checking file mtimes.
   * Throttled to once per STALENESS_CHECK_INTERVAL_MS.
   * Returns IDs of entries that need re-embedding (stale or new files).
   */
  refreshStaleCacheEntries(): string[] {
    const now = Date.now();
    if (now - this.lastStalenessCheck < STALENESS_CHECK_INTERVAL_MS) return [];
    this.lastStalenessCheck = now;

    const staleIds: string[] = [];

    // Check existing cache entries against file mtimes
    const cacheEntries = this.cacheDb.prepare('SELECT id, file_mtime FROM query_vectors').all() as {
      id: string;
      file_mtime: number;
    }[];

    for (const entry of cacheEntries) {
      const filePath = this.idToPath.get(entry.id);
      if (!filePath || !fs.existsSync(filePath)) {
        // File deleted or path unknown — remove from cache, map, and slug set
        if (filePath) {
          this.slugsInUse.delete(path.basename(filePath, '.md'));
        }
        this.cacheDb.prepare('DELETE FROM query_vectors WHERE id = ?').run(entry.id);
        this.idToPath.delete(entry.id);
        continue;
      }
      const currentMtime = statSync(filePath).mtimeMs;
      if (currentMtime !== entry.file_mtime) {
        staleIds.push(entry.id);
      }
    }

    // Scan disk for new/renamed files not in our id map
    const knownPaths = new Set(this.idToPath.values());
    const cachedIds = new Set(cacheEntries.map((e) => e.id));
    for (const fileName of this.listMdFiles()) {
      const filePath = path.join(this.memoriesDir, fileName);
      if (knownPaths.has(filePath)) continue;

      // New or renamed file — parse frontmatter to get ID
      try {
        const content = fs.readFileSync(filePath, 'utf-8');
        const parsed = parseMemoryFile(content);
        if (parsed) {
          // Clean up old slug if this ID was previously mapped to a different path
          const oldPath = this.idToPath.get(parsed.id);
          if (oldPath) {
            this.slugsInUse.delete(path.basename(oldPath, '.md'));
          }

          const slug = path.basename(fileName, '.md');
          this.idToPath.set(parsed.id, filePath);
          this.slugsInUse.add(slug);
          if (!cachedIds.has(parsed.id)) {
            staleIds.push(parsed.id);
          }
        }
      } catch {
        // Skip unreadable files
      }
    }

    return staleIds;
  }

  /**
   * Update a single vector cache entry. Called after re-embedding a stale file.
   */
  updateCacheVector(id: string, queryVector: number[]): void {
    const filePath = this.getFilePath(id);
    const memoryFile = this.loadMemoryFile(id);
    if (!memoryFile) {
      throw new MemoryError(`Cannot update cache: memory file for ${id} is missing or corrupt`);
    }

    const mtime = statSync(filePath).mtimeMs;
    this.upsertCacheEntry(id, queryVector, memoryFile.project, memoryFile.createdAt, mtime);
  }

  // --- Symlink management ---

  /**
   * Create a symlink from <projectRoot>/.memories to the memories dir.
   * No-op if symlink already exists and points correctly.
   */
  ensureProjectSymlink(projectRoot: string): void {
    const symlinkPath = path.join(projectRoot, '.memories');

    // Normalize target for comparison
    const target = this.memoriesDir.replace(/\\/g, '/');

    try {
      const existingTarget = fs.readlinkSync(symlinkPath);
      if (existingTarget.replace(/\\/g, '/') === target) return;
      // Points to wrong target — remove and recreate
      unlinkSync(symlinkPath);
    } catch {
      // Symlink doesn't exist — create it
    }

    try {
      fs.symlinkSync(target, symlinkPath, 'junction');
    } catch {
      // Best effort — symlink creation can fail on some OS configurations
    }
  }

  // --- Public accessors for tests ---

  /**
   * Get the file path for a memory ID. Returns undefined if not in the map.
   */
  getFilePathForId(id: string): string | undefined {
    return this.idToPath.get(id);
  }

  // --- Private helpers ---

  private getCachedVector(id: string): number[] {
    const row = this.cacheDb
      .prepare('SELECT query_vector FROM query_vectors WHERE id = ?')
      .get(id) as VectorCacheRow | undefined;
    if (!row) {
      throw new MemoryError(`Vector cache missing entry for ${id} — rebuild cache`);
    }
    return blobToVector(row.query_vector);
  }

  /**
   * Non-throwing variant — returns null if the cache entry is missing
   * (e.g. file exists on disk but hasn't been embedded yet).
   */
  private tryGetCachedVector(id: string): number[] | null {
    const row = this.cacheDb
      .prepare('SELECT query_vector FROM query_vectors WHERE id = ?')
      .get(id) as VectorCacheRow | undefined;
    if (!row) return null;
    return blobToVector(row.query_vector);
  }

  private getFilePath(id: string): string {
    const mapped = this.idToPath.get(id);
    if (mapped) return mapped;
    throw new MemoryError(`No file path mapped for memory ID ${id}`);
  }

  private loadMemoryFile(id: string): MemoryFile | null {
    const filePath = this.idToPath.get(id);
    if (!filePath) return null;
    try {
      const content = fs.readFileSync(filePath, 'utf-8');
      return parseMemoryFile(content);
    } catch {
      return null;
    }
  }

  private loadAllMemoryFiles(): MemoryFile[] {
    const files = this.listMdFiles();
    const results: MemoryFile[] = [];

    for (const fileName of files) {
      const filePath = path.join(this.memoriesDir, fileName);
      try {
        const content = fs.readFileSync(filePath, 'utf-8');
        const parsed = parseMemoryFile(content);
        if (parsed) results.push(parsed);
      } catch {
        // Skip unreadable files
      }
    }

    return results;
  }

  private listMdFiles(): string[] {
    try {
      return readdirSync(this.memoriesDir).filter((f) => f.endsWith('.md'));
    } catch {
      return [];
    }
  }

  private upsertCacheEntry(
    id: string,
    queryVector: number[],
    project: string,
    createdAt: string,
    mtime: number,
  ): void {
    this.cacheDb
      .prepare(
        `INSERT OR REPLACE INTO query_vectors (id, query_vector, project, created_at, file_mtime)
         VALUES (?, ?, ?, ?, ?)`,
      )
      .run(id, vectorToBlob(queryVector), project, createdAt, mtime);
  }

  private memoryFileToQueryRecord(memoryFile: MemoryFile, queryVector: number[]): QueryRecord {
    return {
      id: memoryFile.id,
      query_text: memoryFile.query,
      query_vector: queryVector,
      session_id: memoryFile.sessionId,
      project: memoryFile.project,
      created_at: memoryFile.createdAt,
    };
  }

  private memoryFileToFactRecords(memoryFile: MemoryFile): FactRecord[] {
    return memoryFile.facts.map((fact: MemoryFileFact, index: number) => ({
      id: `${memoryFile.id}:${index}`,
      query_id: memoryFile.id,
      fact_text: fact.text,
      kind: fact.kind,
      created_at: memoryFile.createdAt,
    }));
  }
}
