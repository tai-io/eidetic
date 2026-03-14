import { describe, it, expect } from 'vitest';
import { slugify, resolveSlugCollision } from '../slug.js';

describe('slugify', () => {
  it('lowercases and replaces spaces with hyphens', () => {
    expect(slugify('How Does Auth Work')).toBe('how-does-auth-work');
  });

  it('strips punctuation', () => {
    expect(slugify('What is the API endpoint?')).toBe('what-is-the-api-endpoint');
  });

  it('collapses multiple non-alphanum chars into single hyphen', () => {
    expect(slugify('foo---bar   baz')).toBe('foo-bar-baz');
  });

  it('trims leading and trailing hyphens', () => {
    expect(slugify('  --hello world--  ')).toBe('hello-world');
  });

  it('handles unicode by NFD-normalizing and stripping combining marks', () => {
    expect(slugify('café résumé')).toBe('cafe-resume');
  });

  it('handles CJK and non-latin characters by removing them', () => {
    expect(slugify('hello 世界')).toBe('hello');
  });

  it('truncates to 80 chars at word boundary', () => {
    const long =
      'this is a very long query that should be truncated at a word boundary to keep filenames reasonable and readable for humans';
    const result = slugify(long);
    expect(result.length).toBeLessThanOrEqual(80);
    expect(result.endsWith('-')).toBe(false);
    // Should not cut in the middle of a word
    expect(long.toLowerCase()).toContain(result.replaceAll('-', ' '));
  });

  it('returns "untitled" for empty string', () => {
    expect(slugify('')).toBe('untitled');
  });

  it('returns "untitled" for all-special-character input', () => {
    expect(slugify('!!!???...')).toBe('untitled');
  });

  it('returns "untitled" for whitespace-only input', () => {
    expect(slugify('   ')).toBe('untitled');
  });

  it('handles single word', () => {
    expect(slugify('Authentication')).toBe('authentication');
  });

  it('handles numbers', () => {
    expect(slugify('Step 3 of 10')).toBe('step-3-of-10');
  });
});

describe('resolveSlugCollision', () => {
  it('returns slug unchanged when no collision', () => {
    const existing = new Set<string>();
    expect(resolveSlugCollision('my-slug', existing)).toBe('my-slug');
  });

  it('appends -2 on first collision', () => {
    const existing = new Set(['my-slug']);
    expect(resolveSlugCollision('my-slug', existing)).toBe('my-slug-2');
  });

  it('appends -3 when -2 is also taken', () => {
    const existing = new Set(['my-slug', 'my-slug-2']);
    expect(resolveSlugCollision('my-slug', existing)).toBe('my-slug-3');
  });

  it('handles many collisions', () => {
    const existing = new Set(['test', 'test-2', 'test-3', 'test-4', 'test-5']);
    expect(resolveSlugCollision('test', existing)).toBe('test-6');
  });
});
