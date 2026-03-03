import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { ToolHandlers } from '../tools.js';
import { MockEmbedding } from '../__tests__/mock-embedding.js';
import { MockVectorDB } from '../__tests__/mock-vectordb.js';
import { StateManager } from '../state/snapshot.js';
import { SAMPLE_TS } from '../__tests__/fixtures.js';

let tmpDataDir: string;

// Mock paths to use temp dir
vi.mock('../paths.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../paths.js')>();
  return {
    ...actual,
    getSnapshotDbPath: () => path.join(tmpDataDir, 'snapshots.db'),
    getSnapshotDir: () => path.join(tmpDataDir, 'snapshots'),
    getDataDir: () => tmpDataDir,
    getCacheDir: () => path.join(tmpDataDir, 'cache'),
    getRegistryPath: () => path.join(tmpDataDir, 'registry.json'),
  };
});

describe('Full pipeline: index → search → status → clear', () => {
  let embedding: MockEmbedding;
  let vectordb: MockVectorDB;
  let state: StateManager;
  let handlers: ToolHandlers;
  let tmpCodebase: string;

  beforeEach(() => {
    embedding = new MockEmbedding();
    vectordb = new MockVectorDB();
    state = new StateManager();
    handlers = new ToolHandlers(embedding, vectordb, state);
    tmpDataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'eidetic-e2e-'));
    tmpCodebase = fs.mkdtempSync(path.join(os.tmpdir(), 'eidetic-code-'));
    fs.mkdirSync(path.join(tmpCodebase, 'src'), { recursive: true });
    fs.writeFileSync(path.join(tmpCodebase, 'src', 'main.ts'), SAMPLE_TS);
  });

  afterEach(() => {
    fs.rmSync(tmpDataDir, { recursive: true, force: true });
    fs.rmSync(tmpCodebase, { recursive: true, force: true });
  });

  it('completes full lifecycle', async () => {
    // 1. Index
    const indexResult = await handlers.handleIndexCodebase({ path: tmpCodebase });
    expect(indexResult.content[0].text).toContain('Indexing complete');
    expect(indexResult.content[0].text).toContain('Total files');

    // 2. Search
    const searchResult = await handlers.handleSearchCode({
      path: tmpCodebase,
      query: 'greet Calculator',
    });
    expect(searchResult.content[0].text).toBeDefined();
    // Should find results since we indexed
    expect(searchResult.content[0].text).not.toContain('not indexed');

    // 3. Get status
    const statusResult = await handlers.handleGetIndexingStatus({ path: tmpCodebase });
    expect(statusResult.content[0].text).toContain('indexed');

    // 4. List indexed
    const listResult = await handlers.handleListIndexed();
    expect(listResult.content[0].text).not.toContain('No codebases');

    // 5. Clear
    const clearResult = await handlers.handleClearIndex({ path: tmpCodebase });
    expect(clearResult.content[0].text).toContain('cleared');

    // 6. Verify cleared
    const afterClear = await handlers.handleListIndexed();
    expect(afterClear.content[0].text).toContain('No codebases');
  });
});
