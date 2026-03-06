import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { Metadata } from 'chromadb';

// Mock chromadb module
const mockCollection: Record<string, ReturnType<typeof vi.fn>> = {
  add: vi.fn(),
  upsert: vi.fn(),
  query: vi.fn(),
  get: vi.fn(),
  update: vi.fn(),
  delete: vi.fn(),
  count: vi.fn(),
};

const mockClient = {
  getOrCreateCollection: vi.fn().mockResolvedValue(mockCollection),
  getCollection: vi.fn().mockResolvedValue(mockCollection),
  listCollections: vi.fn().mockResolvedValue([]),
  deleteCollection: vi.fn(),
};

vi.mock('chromadb', () => {
  const MockChromaClient = vi.fn();
  MockChromaClient.prototype = {};
  return {
    ChromaClient: class {
      constructor() {
        return mockClient;
      }
    },
  };
});

import { ChromaVectorDB } from '../chroma.js';
import type { CodeDocument, HybridSearchParams } from '../types.js';

function makeDoc(id: string, content: string, overrides: Partial<CodeDocument> = {}): CodeDocument {
  return {
    id,
    content,
    vector: [0.1, 0.2, 0.3],
    relativePath: 'test.ts',
    startLine: 1,
    endLine: 10,
    fileExtension: '.ts',
    language: 'typescript',
    ...overrides,
  };
}

describe('ChromaVectorDB', () => {
  let db: ChromaVectorDB;

  beforeEach(() => {
    vi.clearAllMocks();
    db = new ChromaVectorDB();
  });

  describe('createCollection', () => {
    it('creates collection with cosine space', async () => {
      await db.createCollection('test', 3);
      expect(mockClient.getOrCreateCollection).toHaveBeenCalledWith({
        name: 'test',
        configuration: { hnsw: { space: 'cosine' } },
      });
    });
  });

  describe('hasCollection', () => {
    it('returns true when collection exists', async () => {
      mockClient.listCollections.mockResolvedValueOnce([{ name: 'test' }]);
      expect(await db.hasCollection('test')).toBe(true);
    });

    it('returns false when collection does not exist', async () => {
      mockClient.listCollections.mockResolvedValueOnce([]);
      expect(await db.hasCollection('test')).toBe(false);
    });

    it('returns false on error', async () => {
      mockClient.listCollections.mockRejectedValueOnce(new Error('connection refused'));
      expect(await db.hasCollection('test')).toBe(false);
    });
  });

  describe('dropCollection', () => {
    it('deletes collection when it exists', async () => {
      mockClient.listCollections.mockResolvedValueOnce([{ name: 'test' }]);
      await db.dropCollection('test');
      expect(mockClient.deleteCollection).toHaveBeenCalledWith({ name: 'test' });
    });

    it('does nothing when collection does not exist', async () => {
      mockClient.listCollections.mockResolvedValueOnce([]);
      await db.dropCollection('test');
      expect(mockClient.deleteCollection).not.toHaveBeenCalled();
    });
  });

  describe('insert', () => {
    it('upserts documents in batches', async () => {
      const docs = [makeDoc('1', 'hello'), makeDoc('2', 'world')];
      await db.insert('test', docs);

      expect(mockCollection.upsert).toHaveBeenCalledTimes(1);
      const call = mockCollection.upsert.mock.calls[0][0] as {
        ids: string[];
        embeddings: number[][];
        documents: string[];
        metadatas: Metadata[];
      };
      expect(call.ids).toEqual(['1', '2']);
      expect(call.documents).toEqual(['hello', 'world']);
      expect(call.embeddings).toEqual([[0.1, 0.2, 0.3], [0.1, 0.2, 0.3]]);
    });

    it('does nothing for empty array', async () => {
      await db.insert('test', []);
      expect(mockCollection.upsert).not.toHaveBeenCalled();
    });
  });

  describe('search', () => {
    it('performs hybrid search with dense + text', async () => {
      mockCollection.query.mockResolvedValueOnce({
        ids: [['1', '2']],
        distances: [[0.1, 0.3]],
        metadatas: [
          [
            { content: 'hello world', relativePath: 'a.ts', startLine: 1, endLine: 5, fileExtension: '.ts', language: 'typescript', fileCategory: 'source' },
            { content: 'foo bar', relativePath: 'b.ts', startLine: 1, endLine: 5, fileExtension: '.ts', language: 'typescript', fileCategory: 'source' },
          ],
        ],
        documents: [['hello world', 'foo bar']],
      });

      mockCollection.get.mockResolvedValueOnce({
        ids: ['1'],
        metadatas: [
          { content: 'hello world', relativePath: 'a.ts', startLine: 1, endLine: 5, fileExtension: '.ts', language: 'typescript', fileCategory: 'source' },
        ],
      });

      const params: HybridSearchParams = {
        queryVector: [0.1, 0.2, 0.3],
        queryText: 'hello world',
        limit: 5,
      };

      const results = await db.search('test', params);
      expect(results.length).toBeGreaterThan(0);
      expect(results[0].content).toBeDefined();
      expect(results[0].score).toBeGreaterThan(0);
    });

    it('handles empty collection gracefully', async () => {
      mockCollection.query.mockResolvedValueOnce({
        ids: [[]],
        distances: [[]],
        metadatas: [[]],
        documents: [[]],
      });

      const results = await db.search('test', {
        queryVector: [0.1, 0.2, 0.3],
        queryText: 'test',
        limit: 5,
      });
      expect(results).toEqual([]);
    });
  });

  describe('getById', () => {
    it('returns point when found', async () => {
      mockCollection.get.mockResolvedValueOnce({
        ids: ['1'],
        embeddings: [[0.1, 0.2]],
        metadatas: [{ content: 'hello' }],
      });

      const result = await db.getById('test', '1');
      expect(result).toEqual({
        payload: { content: 'hello' },
        vector: [0.1, 0.2],
      });
    });

    it('returns null when not found', async () => {
      mockCollection.get.mockResolvedValueOnce({
        ids: [],
        embeddings: [],
        metadatas: [],
      });

      const result = await db.getById('test', 'missing');
      expect(result).toBeNull();
    });
  });

  describe('updatePoint', () => {
    it('updates with vector, metadata and document', async () => {
      await db.updatePoint('test', '1', [0.5, 0.6], { content: 'updated', foo: 'bar' });

      expect(mockCollection.update).toHaveBeenCalledWith({
        ids: ['1'],
        embeddings: [[0.5, 0.6]],
        metadatas: [{ content: 'updated', foo: 'bar' }],
        documents: ['updated'],
      });
    });
  });

  describe('deleteByPath', () => {
    it('deletes by relativePath where filter', async () => {
      await db.deleteByPath('test', 'src/main.ts');

      expect(mockCollection.delete).toHaveBeenCalledWith({
        where: { relativePath: { $eq: 'src/main.ts' } },
      });
    });
  });

  describe('deleteByFilter', () => {
    it('converts flat filter to Chroma where', async () => {
      await db.deleteByFilter('test', { fileCategory: 'test', language: 'typescript' });

      expect(mockCollection.delete).toHaveBeenCalledWith({
        where: {
          $and: [
            { fileCategory: { $eq: 'test' } },
            { language: { $eq: 'typescript' } },
          ],
        },
      });
    });

    it('uses simple where for single filter', async () => {
      await db.deleteByFilter('test', { fileCategory: 'test' });

      expect(mockCollection.delete).toHaveBeenCalledWith({
        where: { fileCategory: { $eq: 'test' } },
      });
    });
  });

  describe('listSymbols', () => {
    it('returns symbol entries from metadata', async () => {
      mockCollection.get.mockResolvedValueOnce({
        ids: ['1'],
        metadatas: [{
          symbolName: 'myFunc',
          symbolKind: 'function',
          relativePath: 'src/utils.ts',
          startLine: 10,
          symbolSignature: 'function myFunc(): void',
          parentSymbol: '',
        }],
      });

      const symbols = await db.listSymbols('test');
      expect(symbols).toHaveLength(1);
      expect(symbols[0]).toEqual({
        name: 'myFunc',
        kind: 'function',
        relativePath: 'src/utils.ts',
        startLine: 10,
        signature: 'function myFunc(): void',
      });
    });
  });

  describe('scrollAll', () => {
    it('returns all points with vectors and metadata', async () => {
      mockCollection.get.mockResolvedValueOnce({
        ids: ['1', '2'],
        embeddings: [[0.1, 0.2], [0.3, 0.4]],
        metadatas: [{ content: 'a' }, { content: 'b' }],
      });

      const results = await db.scrollAll('test');
      expect(results).toHaveLength(2);
      expect(results[0]).toEqual({
        id: '1',
        vector: [0.1, 0.2],
        payload: { content: 'a' },
      });
    });
  });
});
