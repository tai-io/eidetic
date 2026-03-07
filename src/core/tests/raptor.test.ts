import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { kMeans, clusterHash, clusterCodeChunks, storeRaptorSummaries } from '../raptor.js';
import { _resetDb } from '../raptor-cache.js';
import { MockVectorDB } from '../../__tests__/mock-vectordb.js';

let tmpDir: string;

vi.mock('../../paths.js', () => ({
  getRaptorDbPath: () => path.join(tmpDir, 'raptor.db'),
  knowledgeCollectionName: (project: string) => `eidetic_${project}_knowledge`,
  globalConceptsCollectionName: () => 'eidetic_global_concepts',
}));

vi.mock('../../config.js', () => {
  const cfg = {
    raptorEnabled: true,
    raptorTimeoutMs: 60000,
    openaiApiKey: 'test-key',
    openaiBaseUrl: undefined,
  };
  return { getConfig: () => cfg, loadConfig: () => cfg };
});

function makeDoc(id: string, vector: number[]) {
  return {
    id,
    vector,
    content: `function ${id}() {}`,
    relativePath: `${id}.ts`,
    startLine: 0,
    endLine: 10,
    fileExtension: '.ts',
    language: 'typescript',
  };
}

describe('kMeans', () => {
  it('clusters points into k groups', () => {
    const points = [
      { id: 'a', vector: [0, 0], content: 'a' },
      { id: 'b', vector: [0.1, 0.1], content: 'b' },
      { id: 'c', vector: [0.2, 0], content: 'c' },
      { id: 'd', vector: [10, 10], content: 'd' },
      { id: 'e', vector: [10.1, 10.1], content: 'e' },
      { id: 'f', vector: [9.9, 10], content: 'f' },
    ];

    const clusters = kMeans(points, 2);
    expect(clusters).toHaveLength(2);
    expect(clusters.map((c) => c.length).sort()).toEqual([3, 3]);

    const clusterOfA = clusters.find((c) => c.some((p) => p.id === 'a'))!;
    expect(clusterOfA.some((p) => p.id === 'b')).toBe(true);
    expect(clusterOfA.some((p) => p.id === 'c')).toBe(true);
  });

  it('returns empty for empty input', () => {
    expect(kMeans([], 3)).toEqual([]);
  });

  it('returns individual points when k >= n', () => {
    const points = [
      { id: 'a', vector: [1, 2], content: 'a' },
      { id: 'b', vector: [3, 4], content: 'b' },
    ];
    expect(kMeans(points, 5)).toHaveLength(2);
  });
});

describe('clusterHash', () => {
  it('produces consistent hash regardless of order', () => {
    expect(clusterHash(['a', 'b', 'c'])).toBe(clusterHash(['c', 'a', 'b']));
  });

  it('produces different hash for different ids', () => {
    expect(clusterHash(['a', 'b'])).not.toBe(clusterHash(['a', 'c']));
  });
});

describe('clusterCodeChunks', () => {
  let vectordb: MockVectorDB;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'eidetic-raptor-'));
    vectordb = new MockVectorDB();
  });

  afterEach(() => {
    _resetDb();
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it('returns empty clusters when fewer than 3 points', async () => {
    await vectordb.createCollection('code', 3);
    await vectordb.insert('code', [makeDoc('1', [1, 0, 0])]);

    const result = await clusterCodeChunks('test', 'code', vectordb);
    expect(result.clusters).toHaveLength(0);
    expect(result.totalPoints).toBe(1);
  });

  it('returns clusters with chunk data', async () => {
    await vectordb.createCollection('code', 3);
    const docs = Array.from({ length: 9 }, (_, i) =>
      makeDoc(`chunk-${i}`, [i % 3, Math.floor(i / 3), 0]),
    );
    await vectordb.insert('code', docs);

    const result = await clusterCodeChunks('myproj', 'code', vectordb);

    expect(result.clusters.length).toBeGreaterThan(0);
    expect(result.totalPoints).toBe(9);

    for (const cluster of result.clusters) {
      expect(cluster.clusterId).toMatch(/^[a-f0-9]{16}$/);
      expect(cluster.chunks.length).toBeGreaterThan(0);
      for (const chunk of cluster.chunks) {
        expect(chunk.content).toBeTruthy();
        expect(chunk.file).toBeTruthy();
      }
    }
  });

  it('includes cached summaries when available', async () => {
    await vectordb.createCollection('code', 3);
    const docs = Array.from({ length: 6 }, (_, i) =>
      makeDoc(`c-${i}`, [i < 3 ? 0 : 10, i < 3 ? 0 : 10, 0]),
    );
    await vectordb.insert('code', docs);

    // First call — no cache
    const result1 = await clusterCodeChunks('proj', 'code', vectordb);
    expect(result1.clusters.every((c) => c.cachedSummary === undefined)).toBe(true);

    // Simulate storing summaries (populates cache)
    const mockEmbedding = {
      dimension: 3,
      embed: vi.fn().mockResolvedValue([0.1, 0.2, 0.3]),
      embedBatch: vi.fn(),
      estimateTokens: vi.fn(),
      initialize: vi.fn(),
    };
    const summariesToStore = result1.clusters.map((c) => ({
      clusterId: c.clusterId,
      summary: `Summary for ${c.clusterId}`,
    }));
    await storeRaptorSummaries('proj', summariesToStore, mockEmbedding, vectordb);

    // Second call — should have cache
    const result2 = await clusterCodeChunks('proj', 'code', vectordb);
    const cachedCount = result2.clusters.filter((c) => c.cachedSummary).length;
    expect(cachedCount).toBeGreaterThan(0);
  });
});

describe('storeRaptorSummaries', () => {
  let vectordb: MockVectorDB;
  const mockEmbedding = {
    dimension: 3,
    embed: vi.fn().mockResolvedValue([0.1, 0.2, 0.3]),
    embedBatch: vi.fn(),
    estimateTokens: vi.fn(),
    initialize: vi.fn(),
  };

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'eidetic-raptor-'));
    vectordb = new MockVectorDB();
    vi.clearAllMocks();
  });

  afterEach(() => {
    _resetDb();
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it('stores summaries in knowledge collection', async () => {
    const summaries = [
      { clusterId: 'abc123', summary: 'This cluster handles authentication.' },
      { clusterId: 'def456', summary: 'This cluster manages database connections.' },
    ];

    const result = await storeRaptorSummaries('myproj', summaries, mockEmbedding, vectordb);

    expect(result.stored).toBe(2);
    expect(await vectordb.hasCollection('eidetic_myproj_knowledge')).toBe(true);
    expect(mockEmbedding.embed).toHaveBeenCalledTimes(2);
  });

  it('skips empty summaries', async () => {
    const summaries = [
      { clusterId: 'abc', summary: '  ' },
      { clusterId: 'def', summary: 'Valid summary.' },
    ];

    const result = await storeRaptorSummaries('proj', summaries, mockEmbedding, vectordb);
    expect(result.stored).toBe(1);
  });

  it('creates knowledge collection if it does not exist', async () => {
    expect(await vectordb.hasCollection('eidetic_newproj_knowledge')).toBe(false);

    await storeRaptorSummaries(
      'newproj',
      [{ clusterId: 'x', summary: 'A summary.' }],
      mockEmbedding,
      vectordb,
    );

    expect(await vectordb.hasCollection('eidetic_newproj_knowledge')).toBe(true);
  });
});
