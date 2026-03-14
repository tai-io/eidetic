import { describe, it, expect, beforeEach } from 'vitest';
import { join } from 'node:path';
import { mkdtempSync, readFileSync, writeFileSync, unlinkSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { randomUUID } from 'node:crypto';

import { MarkdownMemoryDB } from '../markdown-memorydb.js';
import { MockEmbedding } from '../../__tests__/mock-embedding.js';
import { parseMemoryFile, serializeMemoryFile } from '../markdown-io.js';
import type { MemoryFile } from '../markdown-io.js';

describe('MarkdownMemoryDB', () => {
  let db: MarkdownMemoryDB;
  let memoriesDir: string;
  let embedding: MockEmbedding;

  beforeEach(() => {
    embedding = new MockEmbedding(32);
    const tmpDir = mkdtempSync(join(tmpdir(), 'eidetic-md-test-'));
    memoriesDir = join(tmpDir, 'memories');
    const cachePath = join(tmpDir, '.vector-cache.db');
    db = new MarkdownMemoryDB(memoriesDir, cachePath);
  });

  async function makeQuery(
    overrides: Partial<{ id: string; text: string; project: string; sessionId: string }> = {},
  ) {
    const id = overrides.id ?? randomUUID();
    const text = overrides.text ?? 'How does auth work?';
    return {
      id,
      query_text: text,
      query_vector: await embedding.embed(text),
      session_id: overrides.sessionId ?? 'session-1',
      project: overrides.project ?? 'global',
      created_at: new Date().toISOString(),
    };
  }

  function makeFacts(texts: string[]) {
    return texts.map((text) => ({
      id: randomUUID(),
      fact_text: text,
      kind: 'fact' as const,
      files: [] as string[],
      created_at: new Date().toISOString(),
    }));
  }

  describe('addQueryWithFacts', () => {
    it('creates a slug-named markdown file on disk', async () => {
      const query = await makeQuery();
      db.addQueryWithFacts(query, makeFacts(['Auth uses JWT tokens']));

      const filePath = db.getFilePathForId(query.id);
      expect(filePath).toBeDefined();
      expect(existsSync(filePath!)).toBe(true);
      // Filename should be a slug, not a UUID
      expect(filePath!).toContain('how-does-auth-work.md');

      const content = readFileSync(filePath!, 'utf-8');
      const parsed = parseMemoryFile(content);
      expect(parsed).not.toBeNull();
      expect(parsed!.id).toBe(query.id);
      expect(parsed!.query).toBe('How does auth work?');
      expect(parsed!.facts).toHaveLength(1);
      expect(parsed!.facts[0].text).toBe('Auth uses JWT tokens');
    });

    it('stores vector in cache for search', async () => {
      const query = await makeQuery();
      db.addQueryWithFacts(query, makeFacts(['Some fact']));

      const results = db.searchByQuery(query.query_vector, undefined, 10);
      expect(results).toHaveLength(1);
      expect(results[0].query.id).toBe(query.id);
    });

    it('resolves slug collisions with suffix', async () => {
      const q1 = await makeQuery({ text: 'How does auth work?' });
      const q2 = await makeQuery({ text: 'How does auth work?' });
      db.addQueryWithFacts(q1, makeFacts(['Fact 1']));
      db.addQueryWithFacts(q2, makeFacts(['Fact 2']));

      const path1 = db.getFilePathForId(q1.id);
      const path2 = db.getFilePathForId(q2.id);
      expect(path1).toContain('how-does-auth-work.md');
      expect(path2).toContain('how-does-auth-work-2.md');
    });
  });

  describe('addFactsToQuery', () => {
    it('appends facts to existing markdown file', async () => {
      const query = await makeQuery();
      db.addQueryWithFacts(query, makeFacts(['First fact']));

      db.addFactsToQuery(query.id, makeFacts(['Second fact']));

      const filePath = db.getFilePathForId(query.id)!;
      const parsed = parseMemoryFile(readFileSync(filePath, 'utf-8'));
      expect(parsed!.facts).toHaveLength(2);
      expect(parsed!.facts[1].text).toBe('Second fact');
    });
  });

  describe('searchByQuery', () => {
    it('finds by cosine similarity from cache', async () => {
      const vec1 = await embedding.embed('TypeScript conventions');
      db.addQueryWithFacts(
        {
          id: randomUUID(),
          query_text: 'TypeScript conventions',
          query_vector: vec1,
          session_id: 's1',
          project: 'global',
          created_at: new Date().toISOString(),
        },
        makeFacts(['Uses strict mode']),
      );

      const vec2 = await embedding.embed('JavaScript conventions');
      db.addQueryWithFacts(
        {
          id: randomUUID(),
          query_text: 'JavaScript conventions',
          query_vector: vec2,
          session_id: 's1',
          project: 'global',
          created_at: new Date().toISOString(),
        },
        makeFacts(['Uses ESM modules']),
      );

      const searchVec = await embedding.embed('TypeScript conventions');
      const results = db.searchByQuery(searchVec, undefined, 10);
      expect(results.length).toBeGreaterThan(0);
      expect(results[0].query.query_text).toBe('TypeScript conventions');
    });

    it('filters by project', async () => {
      const vec = await embedding.embed('Test query');
      db.addQueryWithFacts(
        {
          id: randomUUID(),
          query_text: 'Test query',
          query_vector: vec,
          session_id: 's1',
          project: 'proj-a',
          created_at: new Date().toISOString(),
        },
        makeFacts(['Fact A']),
      );

      db.addQueryWithFacts(
        {
          id: randomUUID(),
          query_text: 'Other query',
          query_vector: await embedding.embed('Other query'),
          session_id: 's1',
          project: 'proj-b',
          created_at: new Date().toISOString(),
        },
        makeFacts(['Fact B']),
      );

      const results = db.searchByQuery(vec, 'proj-a', 10);
      expect(results).toHaveLength(1);
      expect(results[0].query.project).toBe('proj-a');
    });
  });

  describe('external file edits', () => {
    it('detects externally edited files on staleness check', async () => {
      const query = await makeQuery();
      db.addQueryWithFacts(query, makeFacts(['Original fact']));

      // Edit file externally
      const filePath = db.getFilePathForId(query.id)!;
      const content = readFileSync(filePath, 'utf-8');
      const parsed = parseMemoryFile(content)!;
      parsed.facts.push({ kind: 'decision', text: 'New external fact' });
      writeFileSync(filePath, serializeMemoryFile(parsed));

      // Force staleness check (reset throttle)
      (db as unknown as { lastStalenessCheck: number }).lastStalenessCheck = 0;

      const staleIds = db.refreshStaleCacheEntries();
      expect(staleIds).toContain(query.id);
    });

    it('reflects edited facts in getFactsForQuery', async () => {
      const query = await makeQuery();
      db.addQueryWithFacts(query, makeFacts(['Original fact']));

      // Edit file externally
      const filePath = db.getFilePathForId(query.id)!;
      const content = readFileSync(filePath, 'utf-8');
      const parsed = parseMemoryFile(content)!;
      parsed.facts.push({ kind: 'decision', text: 'New external fact' });
      writeFileSync(filePath, serializeMemoryFile(parsed));

      // getFactsForQuery reads from disk
      const facts = db.getFactsForQuery(query.id);
      expect(facts).toHaveLength(2);
      expect(facts[1].fact_text).toBe('New external fact');
    });
  });

  describe('file deletion', () => {
    it('detects deleted files on staleness check', async () => {
      const query = await makeQuery();
      db.addQueryWithFacts(query, makeFacts(['Some fact']));

      // Delete file externally
      unlinkSync(db.getFilePathForId(query.id)!);

      // Force staleness check
      (db as unknown as { lastStalenessCheck: number }).lastStalenessCheck = 0;
      db.refreshStaleCacheEntries();

      // Search should no longer find it
      const results = db.searchByQuery(query.query_vector, undefined, 10);
      expect(results).toHaveLength(0);
    });

    it('deleteQuery removes both file and cache entry', async () => {
      const query = await makeQuery();
      db.addQueryWithFacts(query, makeFacts(['Some fact']));

      const filePath = db.getFilePathForId(query.id)!;
      const deleted = db.deleteQuery(query.id);
      expect(deleted).toBe(true);
      expect(existsSync(filePath)).toBe(false);

      const results = db.searchByQuery(query.query_vector, undefined, 10);
      expect(results).toHaveLength(0);
    });

    it('deleteQuery returns false for non-existent file', () => {
      expect(db.deleteQuery('non-existent-id')).toBe(false);
    });
  });

  describe('findSimilarQuery', () => {
    it('finds queries above threshold', async () => {
      const vec = await embedding.embed('TypeScript conventions');
      db.addQueryWithFacts(
        {
          id: randomUUID(),
          query_text: 'TypeScript conventions',
          query_vector: vec,
          session_id: 's1',
          project: 'global',
          created_at: new Date().toISOString(),
        },
        makeFacts(['Uses strict mode']),
      );

      // Same text → cosine 1.0 → above 0.92 threshold
      const result = db.findSimilarQuery(vec, 'global');
      expect(result).not.toBeNull();
      expect(result!.query.query_text).toBe('TypeScript conventions');
      expect(result!.similarity).toBeCloseTo(1.0);
    });

    it('returns null when no similar query exists', async () => {
      const vec = await embedding.embed('TypeScript conventions');
      db.addQueryWithFacts(
        {
          id: randomUUID(),
          query_text: 'TypeScript conventions',
          query_vector: vec,
          session_id: 's1',
          project: 'global',
          created_at: new Date().toISOString(),
        },
        makeFacts(['Uses strict mode']),
      );

      // Different project → no match
      const differentVec = await embedding.embed('something completely different xyz');
      const result = db.findSimilarQuery(differentVec, 'other-project');
      expect(result).toBeNull();
    });
  });

  describe('listByProject / listAll', () => {
    it('lists files filtered by project', async () => {
      db.addQueryWithFacts(await makeQuery({ text: 'Q1', project: 'proj-a' }), makeFacts(['F1']));
      db.addQueryWithFacts(await makeQuery({ text: 'Q2', project: 'proj-b' }), makeFacts(['F2']));

      const listA = db.listByProject('proj-a');
      expect(listA).toHaveLength(1);
      expect(listA[0].query.project).toBe('proj-a');
    });

    it('listAll returns all memories', async () => {
      db.addQueryWithFacts(await makeQuery({ text: 'Q1', project: 'proj-a' }), makeFacts(['F1']));
      db.addQueryWithFacts(await makeQuery({ text: 'Q2', project: 'proj-b' }), makeFacts(['F2']));

      const all = db.listAll();
      expect(all).toHaveLength(2);
    });

    it('listByProject filters by kind', async () => {
      const query = await makeQuery({ project: 'proj-a' });
      db.addQueryWithFacts(query, [
        {
          id: randomUUID(),
          fact_text: 'Fact',
          kind: 'fact',
          files: [],
          created_at: new Date().toISOString(),
        },
        {
          id: randomUUID(),
          fact_text: 'Decision',
          kind: 'decision',
          files: [],
          created_at: new Date().toISOString(),
        },
      ]);

      const filtered = db.listByProject('proj-a', 50, 'fact');
      expect(filtered).toHaveLength(1);
      expect(filtered[0].facts).toHaveLength(1);
      expect(filtered[0].facts[0].kind).toBe('fact');
    });
  });

  describe('queryCount', () => {
    it('counts all queries', async () => {
      db.addQueryWithFacts(await makeQuery({ text: 'Q1' }), makeFacts(['F1']));
      db.addQueryWithFacts(await makeQuery({ text: 'Q2' }), makeFacts(['F2']));
      expect(db.queryCount()).toBe(2);
    });

    it('counts by project', async () => {
      db.addQueryWithFacts(await makeQuery({ text: 'Q1', project: 'a' }), makeFacts(['F1']));
      db.addQueryWithFacts(await makeQuery({ text: 'Q2', project: 'b' }), makeFacts(['F2']));
      expect(db.queryCount('a')).toBe(1);
    });
  });

  describe('getQueryById', () => {
    it('returns query record from file', async () => {
      const query = await makeQuery();
      db.addQueryWithFacts(query, makeFacts(['Some fact']));

      const result = db.getQueryById(query.id);
      expect(result).not.toBeNull();
      expect(result!.id).toBe(query.id);
      expect(result!.query_text).toBe(query.query_text);
    });

    it('returns null for non-existent query', () => {
      expect(db.getQueryById('non-existent')).toBeNull();
    });
  });

  describe('new file detection', () => {
    it('detects new markdown files not in cache', () => {
      // Manually create a file without going through addQueryWithFacts
      const id = randomUUID();
      const memoryFile: MemoryFile = {
        id,
        query: 'Manually created',
        project: 'global',
        sessionId: 's1',
        createdAt: new Date().toISOString(),
        facts: [{ kind: 'fact', text: 'A fact' }],
      };
      writeFileSync(join(memoriesDir, `manually-created.md`), serializeMemoryFile(memoryFile));

      // Force staleness check
      (db as unknown as { lastStalenessCheck: number }).lastStalenessCheck = 0;
      const staleIds = db.refreshStaleCacheEntries();
      expect(staleIds).toContain(id);
    });
  });
});
