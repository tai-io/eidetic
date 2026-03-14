import { describe, it, expect, beforeEach } from 'vitest';
import { MemoryStore } from '../store.js';
import { MemoryHistory } from '../history.js';
import { QueryMemoryDB } from '../query-memorydb.js';
import { MockEmbedding } from '../../__tests__/mock-embedding.js';
import { join } from 'node:path';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';

describe('MemoryStore', () => {
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

  describe('addQueryWithFacts', () => {
    it('stores a query with facts', async () => {
      const action = await store.addQueryWithFacts(
        'What indentation style does this project use?',
        [{ fact: 'Indentation style is tabs not spaces', kind: 'convention', files: [] }],
        'session-1',
      );

      expect(action.event).toBe('ADD');
      expect(action.query).toBe('What indentation style does this project use?');
      expect(action.factsAdded).toBe(1);
      expect(action.queryId).toBeTruthy();
    });

    it('returns zero factsAdded for empty facts array', async () => {
      const action = await store.addQueryWithFacts('empty query', [], 'session-1');
      expect(action.event).toBe('ADD');
      expect(action.factsAdded).toBe(0);
    });

    it('stores multiple facts under one query', async () => {
      const action = await store.addQueryWithFacts(
        'TypeScript conventions',
        [
          { fact: 'Uses TypeScript strict mode', kind: 'convention', files: [] },
          { fact: 'Prefers pnpm over npm', kind: 'decision', files: [] },
        ],
        'session-1',
      );

      expect(action.event).toBe('ADD');
      expect(action.factsAdded).toBe(2);
    });

    it('merges facts into existing query when cosine >= 0.92', async () => {
      // MockEmbedding is deterministic — same text → same vector → cosine 1.0
      await store.addQueryWithFacts(
        'TypeScript conventions',
        [{ fact: 'Uses strict mode', kind: 'convention', files: [] }],
        'session-1',
      );

      const action = await store.addQueryWithFacts(
        'TypeScript conventions',
        [{ fact: 'Uses ESM only', kind: 'convention', files: [] }],
        'session-2',
      );

      expect(action.event).toBe('MERGE');
      expect(action.factsAdded).toBe(1);
      expect(action.mergedInto).toBeTruthy();
    });

    it('skips duplicate facts during merge', async () => {
      await store.addQueryWithFacts(
        'TypeScript conventions',
        [{ fact: 'Uses strict mode', kind: 'convention', files: [] }],
        'session-1',
      );

      const action = await store.addQueryWithFacts(
        'TypeScript conventions',
        [{ fact: 'Uses strict mode', kind: 'convention', files: [] }],
        'session-2',
      );

      expect(action.event).toBe('MERGE');
      expect(action.factsAdded).toBe(0);
    });
  });

  describe('addMemory (legacy)', () => {
    it('wraps addQueryWithFacts', async () => {
      const actions = await store.addMemory([
        { fact: 'Indentation style is tabs not spaces', kind: 'convention', files: [] },
      ]);

      expect(actions).toHaveLength(1);
      expect(actions[0].event).toBe('ADD');
      expect(actions[0].factsAdded).toBe(1);
    });

    it('returns empty array when given empty facts', async () => {
      const actions = await store.addMemory([]);
      expect(actions).toHaveLength(0);
    });
  });

  describe('searchMemory', () => {
    it('returns matching facts', async () => {
      await store.addQueryWithFacts(
        'What indentation style?',
        [{ fact: 'Uses tabs', kind: 'convention', files: [] }],
        'session-1',
      );

      const results = await store.searchMemory('indentation');
      expect(results.length).toBeGreaterThan(0);
      expect(results[0].memory).toBe('Uses tabs');
      expect(results[0].kind).toBe('convention');
    });

    it('returns MemoryItems with correct shape', async () => {
      await store.addQueryWithFacts(
        'test query',
        [{ fact: 'test fact', kind: 'fact', files: [] }],
        'session-1',
      );

      const results = await store.searchMemory('test');
      expect(results[0]).toHaveProperty('id');
      expect(results[0]).toHaveProperty('memory');
      expect(results[0]).toHaveProperty('kind');
      expect(results[0]).toHaveProperty('source');
      expect(results[0]).toHaveProperty('project');
      expect(results[0]).toHaveProperty('created_at');
    });
  });

  describe('deleteMemory', () => {
    it('deletes an existing query and its facts', async () => {
      const action = await store.addQueryWithFacts(
        'Use React 19',
        [{ fact: 'Use React 19', kind: 'fact', files: [] }],
        'session-1',
      );
      const queryId = action.queryId;

      const deleted = store.deleteMemory(queryId);
      expect(deleted).toBe(true);

      const historyEntries = history.getHistory(queryId);
      expect(historyEntries).toHaveLength(2); // ADD + DELETE
      expect(historyEntries[0].event).toBe('ADD');
      expect(historyEntries[1].event).toBe('DELETE');
    });

    it('returns false for non-existent query', async () => {
      const deleted = store.deleteMemory('non-existent-id');
      expect(deleted).toBe(false);
    });
  });

  describe('getHistory', () => {
    it('returns history entries for a query', async () => {
      const action = await store.addQueryWithFacts(
        'Prefers dark mode',
        [{ fact: 'Prefers dark mode', kind: 'fact', files: [] }],
        'session-1',
      );

      const entries = store.getHistory(action.queryId);
      expect(entries).toHaveLength(1);
      expect(entries[0].event).toBe('ADD');
      expect(entries[0].memory_id).toBe(action.queryId);
    });
  });

  describe('project scoping', () => {
    it('stores project field on added query', async () => {
      const action = await store.addQueryWithFacts(
        'Docker build issues',
        [{ fact: 'Docker build fails on M1; use --platform linux/amd64', kind: 'fact', files: [] }],
        'session-1',
        'my-project',
      );

      expect(action.project).toBe('my-project');
    });

    it('defaults project to "global" when not specified', async () => {
      const action = await store.addQueryWithFacts(
        'Use tabs not spaces',
        [{ fact: 'Use tabs not spaces', kind: 'convention', files: [] }],
        'session-1',
      );

      expect(action.project).toBe('global');
    });

    it('includes both project and global memories when project specified', async () => {
      await store.addQueryWithFacts(
        'Global convention query',
        [{ fact: 'Global convention', kind: 'convention', files: [] }],
        'session-1',
        'global',
      );
      await store.addQueryWithFacts(
        'Project convention query',
        [{ fact: 'Project-specific convention', kind: 'convention', files: [] }],
        'session-1',
        'my-project',
      );

      const results = await store.searchMemory('convention', 10, undefined, 'my-project');
      const projects = results.map((m) => m.project);
      expect(projects).toContain('my-project');
      expect(projects).toContain('global');
    });
  });

  describe('kind field', () => {
    it('stores and retrieves kind field', async () => {
      await store.addQueryWithFacts(
        'Offline requirements',
        [{ fact: 'Must work offline', kind: 'constraint', files: [] }],
        'session-1',
      );

      const results = await store.searchMemory('work offline');
      expect(results[0].kind).toBe('constraint');
    });

    it('supports all five kind values', async () => {
      const kinds = ['fact', 'decision', 'convention', 'constraint', 'intent'] as const;
      for (const kind of kinds) {
        const action = await store.addQueryWithFacts(
          `Test ${kind} query`,
          [{ fact: `Test ${kind} memory`, kind, files: [] }],
          'session-1',
        );
        expect(action.factsAdded).toBe(1);
      }
    });
  });

  describe('listMemories', () => {
    it('returns query groups', async () => {
      await store.addQueryWithFacts(
        'What is the indentation style?',
        [{ fact: 'Fact 1', kind: 'fact', files: [] }],
        'session-1',
      );
      await store.addQueryWithFacts(
        'How does deployment work in production?',
        [{ fact: 'Fact 2', kind: 'decision', files: [] }],
        'session-1',
      );

      const groups = store.listMemories();
      expect(groups.length).toBeGreaterThanOrEqual(1);
      expect(groups[0].query).toBeDefined();
      expect(groups[0].facts).toBeDefined();
    });

    it('filters by project', async () => {
      await store.addQueryWithFacts(
        'Q1',
        [{ fact: 'F1', kind: 'fact', files: [] }],
        's1',
        'proj-a',
      );
      await store.addQueryWithFacts(
        'Q2',
        [{ fact: 'F2', kind: 'fact', files: [] }],
        's1',
        'proj-b',
      );

      const groups = store.listMemories(undefined, 50, 'proj-a');
      expect(groups.every((g) => g.query.project === 'proj-a')).toBe(true);
    });
  });
});
