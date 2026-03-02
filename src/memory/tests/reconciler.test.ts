import { describe, it, expect } from 'vitest';
import { hashMemory, cosineSimilarity, reconcile, type ExistingMatch } from '../reconciler.js';

describe('hashMemory', () => {
  it('produces consistent MD5 hashes', () => {
    const hash1 = hashMemory('I prefer tabs over spaces');
    const hash2 = hashMemory('I prefer tabs over spaces');
    expect(hash1).toBe(hash2);
  });

  it('normalizes whitespace and case', () => {
    const hash1 = hashMemory('  I Prefer Tabs  ');
    const hash2 = hashMemory('i prefer tabs');
    expect(hash1).toBe(hash2);
  });

  it('produces different hashes for different text', () => {
    const hash1 = hashMemory('I prefer tabs');
    const hash2 = hashMemory('I prefer spaces');
    expect(hash1).not.toBe(hash2);
  });
});

describe('cosineSimilarity', () => {
  it('returns 1 for identical vectors', () => {
    const v = [1, 2, 3, 4];
    expect(cosineSimilarity(v, v)).toBeCloseTo(1.0);
  });

  it('returns 0 for orthogonal vectors', () => {
    expect(cosineSimilarity([1, 0], [0, 1])).toBeCloseTo(0.0);
  });

  it('returns -1 for opposite vectors', () => {
    expect(cosineSimilarity([1, 0], [-1, 0])).toBeCloseTo(-1.0);
  });

  it('returns 0 for empty vectors', () => {
    expect(cosineSimilarity([], [])).toBe(0);
  });

  it('returns 0 for mismatched lengths', () => {
    expect(cosineSimilarity([1, 2], [1, 2, 3])).toBe(0);
  });

  it('handles zero vectors', () => {
    expect(cosineSimilarity([0, 0], [1, 2])).toBe(0);
  });
});

describe('reconcile', () => {
  it('returns NONE for exact hash match', () => {
    const hash = hashMemory('I use Vitest');
    const candidates: ExistingMatch[] = [
      {
        id: 'abc',
        memory: 'I use Vitest',
        hash,
        vector: [1, 0, 0],
        score: 0.95,
      },
    ];

    const result = reconcile(hash, [1, 0, 0], candidates);
    expect(result.action).toBe('NONE');
    expect(result.existingId).toBe('abc');
  });

  it('returns UPDATE for high similarity but different hash', () => {
    const newHash = hashMemory('I use Jest for testing');
    const existingHash = hashMemory('I use Vitest for testing');
    // Vectors that are very similar (cosine > 0.92)
    const newVector = [0.9, 0.1, 0.05];
    const existingVector = [0.91, 0.09, 0.04];

    const candidates: ExistingMatch[] = [
      {
        id: 'xyz',
        memory: 'I use Vitest for testing',
        hash: existingHash,
        vector: existingVector,
        score: 0.95,
      },
    ];

    const result = reconcile(newHash, newVector, candidates);
    expect(result.action).toBe('UPDATE');
    expect(result.existingId).toBe('xyz');
    expect(result.existingMemory).toBe('I use Vitest for testing');
  });

  it('returns ADD for low similarity', () => {
    const newHash = hashMemory('I prefer dark mode');
    const existingHash = hashMemory('I use React for frontend');
    // Very different vectors
    const newVector = [1, 0, 0];
    const existingVector = [0, 0, 1];

    const candidates: ExistingMatch[] = [
      {
        id: 'old',
        memory: 'I use React for frontend',
        hash: existingHash,
        vector: existingVector,
        score: 0.3,
      },
    ];

    const result = reconcile(newHash, newVector, candidates);
    expect(result.action).toBe('ADD');
  });

  it('returns ADD for empty candidates', () => {
    const result = reconcile('somehash', [1, 0, 0], []);
    expect(result.action).toBe('ADD');
  });

  it('returns SUPERSEDE for 0.7-0.92 similarity with same kind', () => {
    const newHash = hashMemory('Migrated to Postgres');
    const existingHash = hashMemory('Migrating to Postgres next sprint');
    // Vectors with cosine similarity ~0.85 (in 0.7-0.92 range)
    const newVector = [1, 0, 0];
    const existingVector = [0.85, 0.5, 0.15];

    const candidates: ExistingMatch[] = [
      {
        id: 'old-intent',
        memory: 'Migrating to Postgres next sprint',
        hash: existingHash,
        vector: existingVector,
        score: 0.85,
        kind: 'intent',
      },
    ];

    const result = reconcile(newHash, newVector, candidates, 'intent');
    expect(result.action).toBe('SUPERSEDE');
    expect(result.existingId).toBe('old-intent');
  });

  it('returns ADD for 0.7-0.92 similarity with different kind', () => {
    const newHash = hashMemory('We use Postgres for data');
    const existingHash = hashMemory('Chose Postgres over MySQL');
    // Vectors with cosine similarity ~0.85
    const newVector = [1, 0, 0];
    const existingVector = [0.85, 0.5, 0.15];

    const candidates: ExistingMatch[] = [
      {
        id: 'old-decision',
        memory: 'Chose Postgres over MySQL',
        hash: existingHash,
        vector: existingVector,
        score: 0.85,
        kind: 'decision',
      },
    ];

    // New fact, existing is decision — different kinds, should ADD
    const result = reconcile(newHash, newVector, candidates, 'fact');
    expect(result.action).toBe('ADD');
  });

  it('checks hash before similarity', () => {
    const hash = hashMemory('same text');
    const candidates: ExistingMatch[] = [
      {
        id: 'first',
        memory: 'same text',
        hash,
        vector: [0, 0, 1], // completely different vector
        score: 0.1,
      },
    ];

    // Even with a totally different vector, hash match should win
    const result = reconcile(hash, [1, 0, 0], candidates);
    expect(result.action).toBe('NONE');
  });
});
