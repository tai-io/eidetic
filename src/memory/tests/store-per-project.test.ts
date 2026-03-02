import { describe, it, expect, beforeEach } from 'vitest';
import { MemoryStore } from '../store.js';
import { MemoryHistory } from '../history.js';
import { MockEmbedding } from '../../__tests__/mock-embedding.js';
import { MockVectorDB } from '../../__tests__/mock-vectordb.js';
import { join } from 'node:path';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';

describe('MemoryStore per-project collections', () => {
  let embedding: MockEmbedding;
  let vectordb: MockVectorDB;
  let history: MemoryHistory;
  let store: MemoryStore;
  let tmpDir: string;

  beforeEach(() => {
    embedding = new MockEmbedding(32);
    vectordb = new MockVectorDB();
    tmpDir = mkdtempSync(join(tmpdir(), 'eidetic-test-'));
    history = new MemoryHistory(join(tmpDir, 'test.db'));
    store = new MemoryStore(embedding, vectordb, history);
  });

  it('stores global memories in eidetic_global_memory collection', async () => {
    await store.addMemory([{ fact: 'Global fact', kind: 'fact' }]);

    // Verify collection name used
    const hasGlobal = await vectordb.hasCollection('eidetic_global_memory');
    expect(hasGlobal).toBe(true);
  });

  it('stores project memories in eidetic_<project>_memory collection', async () => {
    await store.addMemory([{ fact: 'Project fact', kind: 'fact' }], 'test', 'my-project');

    const hasProject = await vectordb.hasCollection('eidetic_my-project_memory');
    expect(hasProject).toBe(true);
  });

  it('searches both project and global collections', async () => {
    await store.addMemory(
      [{ fact: 'Global TypeScript convention', kind: 'convention' }],
      'test',
      'global',
    );
    await store.addMemory(
      [{ fact: 'Project TypeScript config', kind: 'convention' }],
      'test',
      'my-project',
    );

    const results = await store.searchMemory('TypeScript', 10, undefined, 'my-project');
    expect(results.length).toBe(2);
    const projects = results.map((m) => m.project);
    expect(projects).toContain('my-project');
    expect(projects).toContain('global');
  });

  it('applies query-classified weighting in search results', async () => {
    // Add a constraint and a fact about the same topic
    await store.addMemory(
      [{ fact: 'Must work offline - hard requirement', kind: 'constraint' }],
      'test',
      'my-project',
    );
    await store.addMemory(
      [{ fact: 'Currently works offline via service worker', kind: 'fact' }],
      'test',
      'my-project',
    );

    // Feasibility query should boost constraints
    const results = await store.searchMemory(
      'can I remove offline support?',
      10,
      undefined,
      'my-project',
    );

    // Both should appear, constraint should rank first due to feasibility profile
    expect(results.length).toBeGreaterThanOrEqual(2);
    const constraintIdx = results.findIndex((m) => m.kind === 'constraint');
    const factIdx = results.findIndex((m) => m.kind === 'fact');
    if (constraintIdx >= 0 && factIdx >= 0) {
      expect(constraintIdx).toBeLessThan(factIdx);
    }
  });

  it('filters out superseded entries from search results', async () => {
    // Add a memory then supersede it
    const actions1 = await store.addMemory(
      [{ fact: 'Using SQLite for storage', kind: 'decision' }],
      'test',
      'my-project',
    );
    const oldId = actions1[0].id;

    // Manually mark it as superseded via the vectordb
    const point = await vectordb.getById('eidetic_my-project_memory', oldId);
    if (point) {
      await vectordb.updatePoint('eidetic_my-project_memory', oldId, point.vector, {
        ...point.payload,
        superseded_by: 'new-id',
      });
    }

    const results = await store.searchMemory('storage', 10, undefined, 'my-project');
    const superseded = results.find((m) => m.id === oldId);
    expect(superseded).toBeUndefined();
  });

  it('deletes memory from correct project collection', async () => {
    const actions = await store.addMemory(
      [{ fact: 'To be deleted', kind: 'fact' }],
      'test',
      'my-project',
    );
    const id = actions[0].id;

    const deleted = await store.deleteMemory(id, 'my-project');
    expect(deleted).toBe(true);
  });

  it('lists memories from specific project collection', async () => {
    await store.addMemory([{ fact: 'Global fact', kind: 'fact' }], 'test', 'global');
    await store.addMemory([{ fact: 'Project fact', kind: 'fact' }], 'test', 'my-project');
    await store.addMemory([{ fact: 'Other project fact', kind: 'fact' }], 'test', 'other-project');

    const results = await store.listMemories(undefined, 50, 'my-project');
    const projects = results.map((m) => m.project);
    expect(projects).toContain('my-project');
    expect(projects).toContain('global');
    expect(projects).not.toContain('other-project');
  });
});
