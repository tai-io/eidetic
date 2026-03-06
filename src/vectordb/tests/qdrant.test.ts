import { describe, it, expect } from 'vitest';
import {
  rankByTermFrequency,
  reciprocalRankFusion,
  extractPayload,
  RRF_K,
  RRF_ALPHA,
} from '../rrf.js';

function makePoint(id: string | number, content: string, extra: Record<string, unknown> = {}) {
  return {
    id,
    payload: {
      content,
      relativePath: 'test.ts',
      startLine: 1,
      endLine: 10,
      fileExtension: '.ts',
      language: 'typescript',
      ...extra,
    },
  };
}

describe('rankByTermFrequency', () => {
  it('scores points by query term matches', () => {
    const points = [
      makePoint(1, 'function hello world'),
      makePoint(2, 'no matching terms here'),
      makePoint(3, 'hello hello hello world world'),
    ];
    const ranked = rankByTermFrequency(points, 'hello world');
    // Point 3 has highest TF for "hello world"
    expect(ranked[0].id).toBe(3);
    expect(ranked[0].rawScore).toBe(1); // normalized max
  });

  it('returns empty for empty input', () => {
    expect(rankByTermFrequency([], 'test')).toEqual([]);
  });

  it('handles no matching terms (all zero scores)', () => {
    const points = [makePoint(1, 'alpha beta gamma')];
    const ranked = rankByTermFrequency(points, 'xyz');
    expect(ranked).toHaveLength(1);
    expect(ranked[0].rawScore).toBe(0);
  });

  it('handles multi-word queries', () => {
    const points = [makePoint(1, 'the quick brown fox'), makePoint(2, 'quick fox quick fox')];
    const ranked = rankByTermFrequency(points, 'quick fox');
    // Point 2 has higher TF for "quick" and "fox"
    expect(ranked[0].id).toBe(2);
  });

  it('is case-insensitive', () => {
    const points = [makePoint(1, 'Hello WORLD Test')];
    const ranked = rankByTermFrequency(points, 'hello world');
    expect(ranked[0].rawScore).toBeGreaterThan(0);
  });

  it('normalizes by word count', () => {
    const shortContent = 'hello world';
    const longContent = 'hello world ' + 'padding '.repeat(100);
    const points = [makePoint(1, shortContent), makePoint(2, longContent)];
    const ranked = rankByTermFrequency(points, 'hello world');
    // Short content has higher TF due to fewer total words
    expect(ranked[0].id).toBe(1);
  });
});

describe('extractPayload', () => {
  it('extracts all fields', () => {
    const point = makePoint('abc', 'test content', {
      relativePath: 'src/main.ts',
      startLine: 5,
      endLine: 20,
      fileExtension: '.ts',
      language: 'typescript',
    });
    const result = extractPayload(point);
    expect(result).toEqual({
      id: 'abc',
      content: 'test content',
      relativePath: 'src/main.ts',
      startLine: 5,
      endLine: 20,
      fileExtension: '.ts',
      language: 'typescript',
      fileCategory: '',
    });
  });

  it('defaults missing fields', () => {
    const result = extractPayload({ id: 1, payload: {} });
    expect(result.content).toBe('');
    expect(result.relativePath).toBe('');
    expect(result.startLine).toBe(0);
    expect(result.endLine).toBe(0);
    expect(result.fileExtension).toBe('');
    expect(result.language).toBe('');
  });

  it('handles null payload', () => {
    const result = extractPayload({ id: 1, payload: null });
    expect(result.content).toBe('');
    expect(result.id).toBe(1);
  });
});

describe('reciprocalRankFusion', () => {
  it('combines dense and text results', () => {
    const dense = [
      { score: 0.9, ...makePoint(1, 'alpha') },
      { score: 0.7, ...makePoint(2, 'beta') },
    ];
    const text = [
      { rawScore: 1.0, ...makePoint(2, 'beta') },
      { rawScore: 0.5, ...makePoint(3, 'gamma') },
    ];
    const results = reciprocalRankFusion(dense, text, 10);
    expect(results.length).toBe(3);
    // ID 2 appears in both lists, should have highest combined score
    expect(results[0].content).toBe('beta');
  });

  it('boosts items appearing in both lists', () => {
    const dense = [{ score: 0.8, ...makePoint(1, 'shared') }];
    const text = [{ rawScore: 0.9, ...makePoint(1, 'shared') }];
    const results = reciprocalRankFusion(dense, text, 10);
    expect(results).toHaveLength(1);
    // Score should be sum of both rank-blended scores
    const singleScore = RRF_ALPHA * (1 / (RRF_K + 0 + 1)) + (1 - RRF_ALPHA) * 0.8;
    expect(results[0].score).toBeGreaterThan(singleScore);
  });

  it('respects limit', () => {
    const dense = Array.from({ length: 10 }, (_, i) => ({
      score: 0.9 - i * 0.05,
      ...makePoint(i, `item${i}`),
    }));
    const results = reciprocalRankFusion(dense, [], 3);
    expect(results).toHaveLength(3);
  });

  it('handles empty inputs', () => {
    expect(reciprocalRankFusion([], [], 10)).toEqual([]);
  });

  it('handles dense-only results', () => {
    const dense = [{ score: 0.9, ...makePoint(1, 'only dense') }];
    const results = reciprocalRankFusion(dense, [], 10);
    expect(results).toHaveLength(1);
    expect(results[0].content).toBe('only dense');
  });

  it('handles text-only results', () => {
    const text = [{ rawScore: 0.9, ...makePoint(1, 'only text') }];
    const results = reciprocalRankFusion([], text, 10);
    expect(results).toHaveLength(1);
    expect(results[0].content).toBe('only text');
  });

  it('uses RRF_ALPHA for blending', () => {
    // Verify the scoring formula matches expectations
    const dense = [{ score: 1.0, ...makePoint(1, 'test') }];
    const results = reciprocalRankFusion(dense, [], 10);
    const expectedScore = RRF_ALPHA * (1 / (RRF_K + 0 + 1)) + (1 - RRF_ALPHA) * 1.0;
    expect(results[0].score).toBeCloseTo(expectedScore, 10);
  });
});
