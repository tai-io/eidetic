import { describe, it, expect, beforeEach } from 'vitest';
import { migrateMemories } from '../migration.js';
import { MockEmbedding } from '../../__tests__/mock-embedding.js';
import { MockVectorDB } from '../../__tests__/mock-vectordb.js';

describe('migrateMemories', () => {
  let embedding: MockEmbedding;
  let vectordb: MockVectorDB;

  beforeEach(() => {
    embedding = new MockEmbedding(32);
    vectordb = new MockVectorDB();
  });

  it('returns 0 when old collection does not exist', async () => {
    const result = await migrateMemories(vectordb, embedding);
    expect(result.migrated).toBe(0);
    expect(result.skipped).toBe(0);
  });

  it('migrates memories from eidetic_memory to per-project collections', async () => {
    // Set up old collection with a memory
    await vectordb.createCollection('eidetic_memory', 32);
    const vector = await embedding.embed('test fact');
    await vectordb.updatePoint('eidetic_memory', 'id-1', vector, {
      content: 'We use TypeScript strict mode',
      relativePath: 'id-1',
      fileExtension: 'conventions',
      language: 'conversation',
      startLine: 0,
      endLine: 0,
      hash: 'abc123',
      memory: 'We use TypeScript strict mode',
      category: 'conventions',
      source: 'conversation',
      project: 'my-project',
      access_count: 5,
      last_accessed: '2026-01-01T00:00:00Z',
      created_at: '2025-12-01T00:00:00Z',
      updated_at: '2025-12-15T00:00:00Z',
    });

    const result = await migrateMemories(vectordb, embedding);
    expect(result.migrated).toBe(1);

    // Verify it was stored in the per-project collection
    const exists = await vectordb.hasCollection('eidetic_my-project_memory');
    expect(exists).toBe(true);

    const point = await vectordb.getById('eidetic_my-project_memory', 'id-1');
    expect(point).not.toBeNull();
    expect(point!.payload.kind).toBe('fact');
    expect(point!.payload.source).toBe('migrated:conventions');
    expect(point!.payload.access_count).toBe(5);
    expect(point!.payload.supersedes).toBeNull();
    expect(point!.payload.superseded_by).toBeNull();
  });

  it('migrates global memories to eidetic_global_memory', async () => {
    await vectordb.createCollection('eidetic_memory', 32);
    const vector = await embedding.embed('global fact');
    await vectordb.updatePoint('eidetic_memory', 'id-g', vector, {
      content: 'Global preference',
      relativePath: 'id-g',
      fileExtension: 'preferences',
      language: '',
      startLine: 0,
      endLine: 0,
      hash: 'def456',
      memory: 'Global preference',
      category: 'preferences',
      source: '',
      project: 'global',
      access_count: 0,
      last_accessed: '',
      created_at: '2025-12-01T00:00:00Z',
      updated_at: '2025-12-01T00:00:00Z',
    });

    const result = await migrateMemories(vectordb, embedding);
    expect(result.migrated).toBe(1);

    const point = await vectordb.getById('eidetic_global_memory', 'id-g');
    expect(point).not.toBeNull();
    expect(point!.payload.kind).toBe('fact');
    expect(point!.payload.source).toBe('migrated:preferences');
  });
});
