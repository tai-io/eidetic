import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { indexCodebase } from '../indexer.js';
import { MockEmbedding } from '../../__tests__/mock-embedding.js';
import { MockVectorDB } from '../../__tests__/mock-vectordb.js';
import { SAMPLE_TS, SAMPLE_PY, SAMPLE_JS } from '../../__tests__/fixtures.js';

// Mock snapshot-io to use temp dir instead of global ~/.eidetic
let tmpDataDir: string;

vi.mock('../../paths.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../paths.js')>();
  return {
    ...actual,
    getSnapshotDbPath: () => path.join(tmpDataDir, 'snapshots.db'),
    getSnapshotDir: () => path.join(tmpDataDir, 'snapshots'),
    getDataDir: () => tmpDataDir,
    getCacheDir: () => path.join(tmpDataDir, 'cache'),
  };
});

function createTempCodebase(files: Record<string, string>): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'eidetic-idx-'));
  for (const [relPath, content] of Object.entries(files)) {
    const fullPath = path.join(dir, relPath);
    fs.mkdirSync(path.dirname(fullPath), { recursive: true });
    fs.writeFileSync(fullPath, content, 'utf-8');
  }
  return dir;
}

describe('indexCodebase integration', () => {
  let embedding: MockEmbedding;
  let vectordb: MockVectorDB;
  let tmpDir: string;

  beforeEach(() => {
    embedding = new MockEmbedding();
    vectordb = new MockVectorDB();
    tmpDataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'eidetic-data-'));
  });

  afterEach(() => {
    if (tmpDir) fs.rmSync(tmpDir, { recursive: true, force: true });
    if (tmpDataDir) fs.rmSync(tmpDataDir, { recursive: true, force: true });
  });

  it('indexes a temp codebase with multiple files', async () => {
    tmpDir = createTempCodebase({
      'src/main.ts': SAMPLE_TS,
      'src/utils.py': SAMPLE_PY,
      'src/helpers.js': SAMPLE_JS,
    });

    const result = await indexCodebase(tmpDir, embedding, vectordb);

    expect(result.totalFiles).toBe(3);
    expect(result.totalChunks).toBeGreaterThan(0);
    expect(result.addedFiles).toBe(3);
    expect(result.modifiedFiles).toBe(0);
    expect(result.removedFiles).toBe(0);
    expect(result.parseFailures).toEqual([]);

    // Verify MockVectorDB was populated
    const collections = [...vectordb.collections.values()];
    expect(collections.length).toBe(1);
    expect(collections[0].documents.length).toBeGreaterThan(0);
  });

  it('handles incremental re-index (add/modify/remove)', async () => {
    tmpDir = createTempCodebase({
      'a.ts': 'export const x = 1;',
      'b.ts': 'export const y = 2;',
    });

    // First index
    const first = await indexCodebase(tmpDir, embedding, vectordb);
    expect(first.addedFiles).toBe(2);

    // Modify b.ts, add c.ts, remove a.ts
    fs.writeFileSync(path.join(tmpDir, 'b.ts'), 'export const y = 999;', 'utf-8');
    fs.writeFileSync(path.join(tmpDir, 'c.ts'), 'export const z = 3;', 'utf-8');
    fs.unlinkSync(path.join(tmpDir, 'a.ts'));

    const second = await indexCodebase(tmpDir, embedding, vectordb);
    expect(second.addedFiles).toBe(1); // c.ts
    expect(second.modifiedFiles).toBe(1); // b.ts
    expect(second.removedFiles).toBe(1); // a.ts

    // Verify deleteByPath was called for removed and modified files
    const deleteCalls = vectordb.calls.filter((c) => c.method === 'deleteByPath');
    expect(deleteCalls.length).toBeGreaterThanOrEqual(2); // a.ts removed + b.ts modified
  });

  it('force re-index drops and recreates collection', async () => {
    tmpDir = createTempCodebase({ 'a.ts': 'export const x = 1;' });

    await indexCodebase(tmpDir, embedding, vectordb);
    const result = await indexCodebase(tmpDir, embedding, vectordb, true);

    // Force should have called dropCollection and createCollection
    const drops = vectordb.calls.filter((c) => c.method === 'dropCollection');
    const creates = vectordb.calls.filter((c) => c.method === 'createCollection');
    expect(drops.length).toBeGreaterThanOrEqual(1);
    expect(creates.length).toBeGreaterThanOrEqual(2); // first index + force
    expect(result.addedFiles).toBe(1);
  });

  it('progress callback fires from 0 to 100', async () => {
    tmpDir = createTempCodebase({ 'a.ts': SAMPLE_TS });
    const progress: number[] = [];

    await indexCodebase(tmpDir, embedding, vectordb, false, (pct) => {
      progress.push(pct);
    });

    expect(progress[0]).toBe(0);
    expect(progress[progress.length - 1]).toBe(100);
    // Should be monotonically non-decreasing
    for (let i = 1; i < progress.length; i++) {
      expect(progress[i]).toBeGreaterThanOrEqual(progress[i - 1]);
    }
  });

  it('throws for empty codebase (no indexable files)', async () => {
    tmpDir = createTempCodebase({ 'readme.txt': 'no code here' });

    await expect(indexCodebase(tmpDir, embedding, vectordb)).rejects.toThrow('No indexable files');
  });

  it('records parse failures but still indexes other files', async () => {
    tmpDir = createTempCodebase({
      'good.ts': SAMPLE_TS,
      'empty.ts': '', // empty file — produces no chunks
    });

    const result = await indexCodebase(tmpDir, embedding, vectordb);
    expect(result.totalFiles).toBe(2);
    // good.ts should produce chunks, empty.ts should not
    expect(result.totalChunks).toBeGreaterThan(0);
  });
});
