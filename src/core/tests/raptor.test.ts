import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { kMeans, clusterHash, runRaptor, type LlmSummarizer } from '../raptor.js';
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
    raptorLlmModel: 'gpt-4o-mini',
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

describe('runRaptor', () => {
  let vectordb: MockVectorDB;
  const mockEmbedding = {
    dimension: 3,
    embed: vi.fn().mockResolvedValue([0.1, 0.2, 0.3]),
    embedBatch: vi.fn(),
    estimateTokens: vi.fn(),
    initialize: vi.fn(),
  };
  const mockSummarize: LlmSummarizer = vi.fn().mockResolvedValue('Summary.');

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'eidetic-raptor-'));
    vectordb = new MockVectorDB();
  });

  afterEach(() => {
    _resetDb();
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it('skips when fewer than 3 points', async () => {
    await vectordb.createCollection('code', 3);
    await vectordb.insert('code', [makeDoc('1', [1, 0, 0])]);

    const result = await runRaptor('test', 'code', mockEmbedding, vectordb, {
      summarize: mockSummarize,
    });
    expect(result.clustersProcessed).toBe(0);
  });

  it('generates summaries for clusters', async () => {
    await vectordb.createCollection('code', 3);
    const docs = Array.from({ length: 9 }, (_, i) =>
      makeDoc(`chunk-${i}`, [i % 3, Math.floor(i / 3), 0]),
    );
    await vectordb.insert('code', docs);

    const result = await runRaptor('myproj', 'code', mockEmbedding, vectordb, {
      summarize: mockSummarize,
    });

    expect(result.clustersProcessed).toBeGreaterThan(0);
    expect(result.summariesGenerated).toBeGreaterThan(0);
    expect(result.timedOut).toBe(false);
    expect(await vectordb.hasCollection('eidetic_myproj_knowledge')).toBe(true);
  });

  it('uses cache on second run', async () => {
    await vectordb.createCollection('code', 3);
    const docs = Array.from({ length: 6 }, (_, i) =>
      makeDoc(`c-${i}`, [i < 3 ? 0 : 10, i < 3 ? 0 : 10, 0]),
    );
    await vectordb.insert('code', docs);

    await runRaptor('proj', 'code', mockEmbedding, vectordb, { summarize: mockSummarize });
    const firstCalls = (mockSummarize as ReturnType<typeof vi.fn>).mock.calls.length;

    const result2 = await runRaptor('proj', 'code', mockEmbedding, vectordb, {
      summarize: mockSummarize,
    });

    expect(result2.cached).toBeGreaterThan(0);
    expect((mockSummarize as ReturnType<typeof vi.fn>).mock.calls.length).toBeLessThanOrEqual(
      firstCalls + result2.summariesGenerated,
    );
  });

  it('stops after timeout', async () => {
    await vectordb.createCollection('code', 3);
    const docs = Array.from({ length: 20 }, (_, i) =>
      makeDoc(`t-${i}`, [Math.random(), Math.random(), Math.random()]),
    );
    await vectordb.insert('code', docs);

    const slowSummarize: LlmSummarizer = vi.fn().mockImplementation(
      () =>
        new Promise<string>((r) =>
          setTimeout(() => {
            r('summary');
          }, 100),
        ),
    );

    const result = await runRaptor('timeout', 'code', mockEmbedding, vectordb, {
      timeoutMs: 50,
      summarize: slowSummarize,
    });
    expect(result.timedOut).toBe(true);
  });
});
