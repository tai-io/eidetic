import { describe, it, expect, beforeEach } from 'vitest';
import { join } from 'node:path';
import { mkdtempSync, existsSync, readdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { randomUUID } from 'node:crypto';

import { migrateToMarkdown } from '../migrate-to-markdown.js';
import { QueryMemoryDB } from '../query-memorydb.js';
import { parseMemoryFile } from '../markdown-io.js';
import { MarkdownMemoryDB } from '../markdown-memorydb.js';
import { MockEmbedding } from '../../__tests__/mock-embedding.js';
import fs from 'node:fs';

describe('migrateToMarkdown', () => {
  let tmpDir: string;
  let oldDbPath: string;
  let memoriesDir: string;
  let vectorCachePath: string;

  beforeEach(() => {
    tmpDir = mkdtempSync(join(tmpdir(), 'eidetic-migrate-test-'));
    oldDbPath = join(tmpDir, 'memorystore.db');
    memoriesDir = join(tmpDir, 'memories');
    vectorCachePath = join(tmpDir, 'memories', '.vector-cache.db');
  });

  it('returns null when old db does not exist', async () => {
    const result = migrateToMarkdown(oldDbPath, memoriesDir, vectorCachePath);
    expect(result).toBeNull();
  });

  it('migrates queries and facts to markdown files', async () => {
    // Set up old database with test data
    const embedding = new MockEmbedding(32);
    const oldDb = new QueryMemoryDB(oldDbPath);
    const vec = await embedding.embed('TypeScript conventions');

    const queryId = randomUUID();
    oldDb.addQueryWithFacts(
      {
        id: queryId,
        query_text: 'TypeScript conventions',
        query_vector: vec,
        session_id: 'session-1',
        project: 'my-project',
        created_at: '2026-03-14T10:00:00.000Z',
      },
      [
        {
          id: randomUUID(),
          fact_text: 'Uses strict mode',
          kind: 'convention',
          created_at: '2026-03-14T10:00:00.000Z',
        },
        {
          id: randomUUID(),
          fact_text: 'ESM only',
          kind: 'decision',
          created_at: '2026-03-14T10:00:00.000Z',
        },
      ],
    );
    oldDb.close();

    const result = migrateToMarkdown(oldDbPath, memoriesDir, vectorCachePath);
    expect(result).not.toBeNull();
    expect(result!.migrated).toBe(1);

    // Verify markdown file
    const files = readdirSync(memoriesDir).filter((f) => f.endsWith('.md'));
    expect(files).toHaveLength(1);
    expect(files[0]).toBe(`${queryId}.md`);

    const content = fs.readFileSync(join(memoriesDir, files[0]), 'utf-8');
    const parsed = parseMemoryFile(content);
    expect(parsed).not.toBeNull();
    expect(parsed!.id).toBe(queryId);
    expect(parsed!.query).toBe('TypeScript conventions');
    expect(parsed!.project).toBe('my-project');
    expect(parsed!.facts).toHaveLength(2);
    expect(parsed!.facts[0]).toEqual({ kind: 'convention', text: 'Uses strict mode' });
    expect(parsed!.facts[1]).toEqual({ kind: 'decision', text: 'ESM only' });
  });

  it('renames old database after migration', async () => {
    const oldDb = new QueryMemoryDB(oldDbPath);
    const embedding = new MockEmbedding(32);
    const vec = await embedding.embed('test');
    oldDb.addQueryWithFacts(
      {
        id: randomUUID(),
        query_text: 'test',
        query_vector: vec,
        session_id: 's1',
        project: 'global',
        created_at: new Date().toISOString(),
      },
      [{ id: randomUUID(), fact_text: 'fact', kind: 'fact', created_at: new Date().toISOString() }],
    );
    oldDb.close();

    migrateToMarkdown(oldDbPath, memoriesDir, vectorCachePath);

    expect(existsSync(oldDbPath)).toBe(false);
    expect(existsSync(`${oldDbPath}.migrated`)).toBe(true);
  });

  it('copies vectors to cache (no re-embedding needed)', async () => {
    const embedding = new MockEmbedding(32);
    const oldDb = new QueryMemoryDB(oldDbPath);
    const vec = await embedding.embed('test query');
    const queryId = randomUUID();

    oldDb.addQueryWithFacts(
      {
        id: queryId,
        query_text: 'test query',
        query_vector: vec,
        session_id: 's1',
        project: 'global',
        created_at: new Date().toISOString(),
      },
      [
        {
          id: randomUUID(),
          fact_text: 'a fact',
          kind: 'fact',
          created_at: new Date().toISOString(),
        },
      ],
    );
    oldDb.close();

    migrateToMarkdown(oldDbPath, memoriesDir, vectorCachePath);

    // The migrated data should be searchable via MarkdownMemoryDB without re-embedding
    const mdDb = new MarkdownMemoryDB(memoriesDir, vectorCachePath);
    const results = mdDb.searchByQuery(vec, undefined, 10);
    expect(results).toHaveLength(1);
    expect(results[0].query.id).toBe(queryId);
    mdDb.close();
  });

  it('skips migration if markdown files already exist', async () => {
    const oldDb = new QueryMemoryDB(oldDbPath);
    const embedding = new MockEmbedding(32);
    oldDb.addQueryWithFacts(
      {
        id: randomUUID(),
        query_text: 'test',
        query_vector: await embedding.embed('test'),
        session_id: 's1',
        project: 'global',
        created_at: new Date().toISOString(),
      },
      [{ id: randomUUID(), fact_text: 'fact', kind: 'fact', created_at: new Date().toISOString() }],
    );
    oldDb.close();

    // Create a fake existing markdown file
    fs.mkdirSync(memoriesDir, { recursive: true });
    fs.writeFileSync(join(memoriesDir, 'existing.md'), 'existing');

    const result = migrateToMarkdown(oldDbPath, memoriesDir, vectorCachePath);
    expect(result).toBeNull();
    // Old db should still be there (not renamed)
    expect(existsSync(oldDbPath)).toBe(true);
  });
});
