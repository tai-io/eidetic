import { describe, it, expect, beforeEach, vi } from 'vitest';
import { replicateToGlobalConcepts } from '../global-concepts.js';
import { MockVectorDB } from '../../__tests__/mock-vectordb.js';

vi.mock('../../paths.js', () => ({
  globalConceptsCollectionName: () => 'eidetic_global_concepts',
}));

const mockEmbedding = {
  dimension: 3,
  embed: vi.fn(),
  embedBatch: vi.fn(),
  estimateTokens: vi.fn(),
  initialize: vi.fn(),
};

function knowledgePayload(content: string, project: string) {
  return {
    content,
    relativePath: content,
    startLine: 0,
    endLine: 0,
    fileExtension: 'knowledge',
    language: 'summary',
    project,
  };
}

describe('replicateToGlobalConcepts', () => {
  let vectordb: MockVectorDB;

  beforeEach(() => {
    vectordb = new MockVectorDB();
  });

  it('creates global collection and replicates points', async () => {
    await vectordb.createCollection('eidetic_myproj_knowledge', 3);
    await vectordb.updatePoint(
      'eidetic_myproj_knowledge',
      'k1',
      [0.1, 0.2, 0.3],
      knowledgePayload('Summary A', 'myproj'),
    );
    await vectordb.updatePoint(
      'eidetic_myproj_knowledge',
      'k2',
      [0.4, 0.5, 0.6],
      knowledgePayload('Summary B', 'myproj'),
    );

    const count = await replicateToGlobalConcepts(
      'myproj',
      'eidetic_myproj_knowledge',
      mockEmbedding,
      vectordb,
    );

    expect(count).toBe(2);
    const globalPoints = await vectordb.scrollAll('eidetic_global_concepts');
    expect(globalPoints).toHaveLength(2);
    expect(String(globalPoints[0].payload.project)).toBe('myproj');
  });

  it('cleans up stale entries on re-replication', async () => {
    await vectordb.createCollection('eidetic_global_concepts', 3);
    await vectordb.updatePoint(
      'eidetic_global_concepts',
      'global_myproj_0',
      [0.1, 0.2, 0.3],
      knowledgePayload('Old', 'myproj'),
    );
    await vectordb.updatePoint(
      'eidetic_global_concepts',
      'global_other_0',
      [0.7, 0.8, 0.9],
      knowledgePayload('Other', 'other'),
    );

    await vectordb.createCollection('eidetic_myproj_knowledge', 3);
    await vectordb.updatePoint(
      'eidetic_myproj_knowledge',
      'k1',
      [0.1, 0.2, 0.3],
      knowledgePayload('New', 'myproj'),
    );

    await replicateToGlobalConcepts('myproj', 'eidetic_myproj_knowledge', mockEmbedding, vectordb);

    const globalPoints = await vectordb.scrollAll('eidetic_global_concepts');
    expect(globalPoints).toHaveLength(2);
    const projects = globalPoints.map((p) => String(p.payload.project));
    expect(projects).toContain('myproj');
    expect(projects).toContain('other');
  });

  it('returns 0 for empty knowledge collection', async () => {
    await vectordb.createCollection('eidetic_empty_knowledge', 3);
    const count = await replicateToGlobalConcepts(
      'empty',
      'eidetic_empty_knowledge',
      mockEmbedding,
      vectordb,
    );
    expect(count).toBe(0);
  });
});
