import { describe, it, expect, beforeEach } from 'vitest';
import { MemoryStore } from '../store.js';
import { MemoryHistory } from '../history.js';
import { QueryMemoryDB } from '../query-memorydb.js';
import { MockEmbedding } from '../../__tests__/mock-embedding.js';
import { join } from 'node:path';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';

describe('MemoryStore per-project scoping', () => {
  let embedding: MockEmbedding;
  let memorydb: QueryMemoryDB;
  let history: MemoryHistory;
  let store: MemoryStore;
  let tmpDir: string;

  beforeEach(() => {
    embedding = new MockEmbedding(32);
    tmpDir = mkdtempSync(join(tmpdir(), 'eidetic-test-'));
    memorydb = new QueryMemoryDB(join(tmpDir, 'memory.db'));
    history = new MemoryHistory(join(tmpDir, 'history.db'));
    store = new MemoryStore(embedding, memorydb, history);
  });

  it('stores global memories with project=global', async () => {
    const action = await store.addQueryWithFacts(
      'Global fact query',
      [{ fact: 'Global fact', kind: 'fact' }],
      'session-1',
    );
    expect(action.project).toBe('global');
  });

  it('stores project-scoped memories', async () => {
    const action = await store.addQueryWithFacts(
      'Project fact query',
      [{ fact: 'Project fact', kind: 'fact' }],
      'session-1',
      'my-project',
    );
    expect(action.project).toBe('my-project');
  });

  it('searches both project and global queries', async () => {
    await store.addQueryWithFacts(
      'Global TypeScript convention',
      [{ fact: 'Global TypeScript convention', kind: 'convention' }],
      'session-1',
      'global',
    );
    await store.addQueryWithFacts(
      'Project TypeScript config',
      [{ fact: 'Project TypeScript config', kind: 'convention' }],
      'session-1',
      'my-project',
    );

    const results = await store.searchMemory('TypeScript', 10, undefined, 'my-project');
    expect(results.length).toBe(2);
    const projects = results.map((m) => m.project);
    expect(projects).toContain('my-project');
    expect(projects).toContain('global');
  });

  it('ranks project-matching memories first via 1.5x boost', async () => {
    await store.addQueryWithFacts(
      'Global TypeScript info',
      [{ fact: 'Global TypeScript fact', kind: 'convention' }],
      'session-1',
      'global',
    );
    await store.addQueryWithFacts(
      'Project TypeScript info',
      [{ fact: 'Project-specific TypeScript config', kind: 'convention' }],
      'session-1',
      'my-project',
    );

    const results = await store.searchMemory('TypeScript', 10, undefined, 'my-project');

    const projectIdx = results.findIndex((m) => m.project === 'my-project');
    const globalIdx = results.findIndex((m) => m.project === 'global');

    expect(projectIdx).toBeGreaterThanOrEqual(0);
    expect(globalIdx).toBeGreaterThanOrEqual(0);
    expect(projectIdx).toBeLessThan(globalIdx);
  });

  it('deletes memory by query ID', async () => {
    const action = await store.addQueryWithFacts(
      'To be deleted',
      [{ fact: 'To be deleted', kind: 'fact' }],
      'session-1',
      'my-project',
    );

    const deleted = store.deleteMemory(action.queryId);
    expect(deleted).toBe(true);
  });

  it('lists memories from specific project', async () => {
    await store.addQueryWithFacts('G1', [{ fact: 'Global fact', kind: 'fact' }], 's1', 'global');
    await store.addQueryWithFacts(
      'P1',
      [{ fact: 'Project fact', kind: 'fact' }],
      's1',
      'my-project',
    );
    await store.addQueryWithFacts(
      'O1',
      [{ fact: 'Other project fact', kind: 'fact' }],
      's1',
      'other-project',
    );

    const results = store.listMemories(undefined, 50, 'my-project');
    const projects = results.map((g) => g.query.project);
    expect(projects).toContain('my-project');
    expect(projects).not.toContain('other-project');
  });
});
