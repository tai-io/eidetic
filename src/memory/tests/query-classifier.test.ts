import { describe, it, expect } from 'vitest';
import {
  classifyQuery,
  getWeightProfile,
  applyKindWeighting,
  applyRecencyDecay,
} from '../query-classifier.js';

describe('classifyQuery', () => {
  it('returns feasibility for "can I" queries', () => {
    expect(classifyQuery('can I use websockets here?')).toBe('feasibility');
  });

  it('returns feasibility for "is it possible" queries', () => {
    expect(classifyQuery('is it possible to run offline?')).toBe('feasibility');
  });

  it('returns feasibility for "allowed to" queries', () => {
    expect(classifyQuery('am I allowed to use external APIs?')).toBe('feasibility');
  });

  it('returns feasibility for "should I" queries', () => {
    expect(classifyQuery('should I use Redux here?')).toBe('feasibility');
  });

  it('returns rationale for "why did" queries', () => {
    expect(classifyQuery('why did we choose Qdrant?')).toBe('rationale');
  });

  it('returns rationale for "why do" queries', () => {
    expect(classifyQuery('why do we use ESM?')).toBe('rationale');
  });

  it('returns rationale for "reason for" queries', () => {
    expect(classifyQuery('what is the reason for using SQLite?')).toBe('rationale');
  });

  it('returns rationale for "how come" queries', () => {
    expect(classifyQuery('how come we avoid process.cwd?')).toBe('rationale');
  });

  it('returns procedural for "how to" queries', () => {
    expect(classifyQuery('how to add a new tool handler?')).toBe('procedural');
  });

  it('returns procedural for "how should" queries', () => {
    expect(classifyQuery('how should I structure the tests?')).toBe('procedural');
  });

  it('returns procedural for "what\'s the pattern" queries', () => {
    expect(classifyQuery("what's the pattern for error handling?")).toBe('procedural');
  });

  it('returns procedural as default', () => {
    expect(classifyQuery('TypeScript configuration')).toBe('procedural');
  });

  it('is case insensitive', () => {
    expect(classifyQuery('CAN I use this library?')).toBe('feasibility');
    expect(classifyQuery('WHY DID we do that?')).toBe('rationale');
  });
});

describe('getWeightProfile', () => {
  it('returns constraint-first for feasibility', () => {
    const profile = getWeightProfile('feasibility');
    const kinds = Object.entries(profile).sort((a, b) => b[1] - a[1]);
    expect(kinds[0][0]).toBe('constraint');
  });

  it('returns decision-first for rationale', () => {
    const profile = getWeightProfile('rationale');
    const kinds = Object.entries(profile).sort((a, b) => b[1] - a[1]);
    expect(kinds[0][0]).toBe('decision');
  });

  it('returns convention-first for procedural', () => {
    const profile = getWeightProfile('procedural');
    const kinds = Object.entries(profile).sort((a, b) => b[1] - a[1]);
    expect(kinds[0][0]).toBe('convention');
  });
});

describe('applyKindWeighting', () => {
  it('boosts score based on kind weight', () => {
    const profile = getWeightProfile('feasibility');
    const constraintScore = applyKindWeighting(0.8, 'constraint', profile);
    const factScore = applyKindWeighting(0.8, 'fact', profile);
    expect(constraintScore).toBeGreaterThan(factScore);
  });

  it('treats unknown kinds as weight 1.0 (no boost)', () => {
    const profile = getWeightProfile('procedural');
    const score = applyKindWeighting(0.8, 'unknown_kind', profile);
    expect(score).toBe(0.8);
  });
});

describe('applyRecencyDecay', () => {
  it('returns full score for today', () => {
    const now = new Date().toISOString();
    const score = applyRecencyDecay(1.0, 'fact', now);
    expect(score).toBeCloseTo(1.0, 1);
  });

  it('decays intent faster than constraint', () => {
    const thirtyDaysAgo = new Date(Date.now() - 30 * 86400000).toISOString();
    const intentScore = applyRecencyDecay(1.0, 'intent', thirtyDaysAgo);
    const constraintScore = applyRecencyDecay(1.0, 'constraint', thirtyDaysAgo);
    expect(constraintScore).toBeGreaterThan(intentScore);
  });

  it('returns full score when valid_at is empty', () => {
    const score = applyRecencyDecay(1.0, 'fact', '');
    expect(score).toBe(1.0);
  });
});
