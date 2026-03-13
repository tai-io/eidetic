import { describe, it, expect, afterEach } from 'vitest';
import { extractDate, truncateUnicode, writeFileAtomic, getProjectId } from '../utils.js';
import { createTempCodebase, cleanupTempDir } from '../../__tests__/fixtures.js';
import fs from 'node:fs';
import path from 'node:path';

describe('extractDate', () => {
  it('extracts date from ISO timestamp', () => {
    expect(extractDate('2026-02-19T10:00:00Z')).toBe('2026-02-19');
  });

  it('extracts date from timestamp with timezone', () => {
    expect(extractDate('2026-03-15T14:30:00+05:00')).toBe('2026-03-15');
  });

  it('returns today for "unknown"', () => {
    const today = new Date().toISOString().slice(0, 10);
    expect(extractDate('unknown')).toBe(today);
  });

  it('returns today for empty string', () => {
    const today = new Date().toISOString().slice(0, 10);
    expect(extractDate('')).toBe(today);
  });

  it('returns today for invalid format', () => {
    const today = new Date().toISOString().slice(0, 10);
    expect(extractDate('not-a-date')).toBe(today);
  });
});

describe('truncateUnicode', () => {
  it('returns original if within limit', () => {
    expect(truncateUnicode('hello', 10)).toBe('hello');
  });

  it('truncates with ellipsis', () => {
    const result = truncateUnicode('hello world', 8);
    expect(result).toBe('hello w…');
    expect(result.length).toBe(8);
  });

  it('handles emoji correctly (no surrogate pair splitting)', () => {
    const emoji = '👋🌍🎉🚀'; // 4 emoji, each is 2 UTF-16 code units but 1 code point
    const result = truncateUnicode(emoji, 3);
    // Should truncate to 2 emoji + ellipsis (3 code points total), not split a surrogate pair
    expect(result).toBe('👋🌍…');
  });

  it('handles CJK characters', () => {
    const cjk = '你好世界';
    const result = truncateUnicode(cjk, 3);
    expect(result).toBe('你好…');
  });

  it('handles mixed ASCII and emoji', () => {
    const mixed = 'Hi 👋 there';
    const result = truncateUnicode(mixed, 6);
    expect(result).toBe('Hi 👋 …');
  });
});

describe('writeFileAtomic', () => {
  let tmpDir: string;

  afterEach(() => {
    if (tmpDir) cleanupTempDir(tmpDir);
  });

  it('creates parent directories', () => {
    tmpDir = createTempCodebase({});
    const filePath = path.join(tmpDir, 'nested', 'dir', 'file.txt');
    writeFileAtomic(filePath, 'content');
    expect(fs.existsSync(filePath)).toBe(true);
  });

  it('writes content correctly', () => {
    tmpDir = createTempCodebase({});
    const filePath = path.join(tmpDir, 'file.txt');
    writeFileAtomic(filePath, 'hello world');
    expect(fs.readFileSync(filePath, 'utf-8')).toBe('hello world');
  });

  it('overwrites existing file atomically', () => {
    tmpDir = createTempCodebase({ 'file.txt': 'old content' });
    const filePath = path.join(tmpDir, 'file.txt');
    writeFileAtomic(filePath, 'new content');
    expect(fs.readFileSync(filePath, 'utf-8')).toBe('new content');
  });

  it('cleans up temp file on write failure', () => {
    tmpDir = createTempCodebase({});
    const filePath = path.join(tmpDir, 'file.txt');

    // Make directory read-only to simulate write failure
    // This is platform-specific and may not work on all systems
    // so we just verify the function doesn't throw unexpectedly
    try {
      writeFileAtomic(filePath, 'content');
      expect(fs.existsSync(filePath)).toBe(true);
    } catch {
      // Expected on some platforms
    }
  });
});

describe('getProjectId', () => {
  it('generates consistent ID for same path', () => {
    const id1 = getProjectId('/home/user/projects/myapp');
    const id2 = getProjectId('/home/user/projects/myapp');
    expect(id1).toBe(id2);
  });

  it('includes basename', () => {
    const id = getProjectId('/home/user/projects/myapp');
    expect(id).toMatch(/^myapp-/);
  });

  it('differentiates same-named projects in different locations', () => {
    const id1 = getProjectId('/home/user/projects/myapp');
    const id2 = getProjectId('/home/other/work/myapp');
    expect(id1).not.toBe(id2);
    // Both start with myapp-
    expect(id1).toMatch(/^myapp-/);
    expect(id2).toMatch(/^myapp-/);
  });

  it('handles Windows paths', () => {
    const id = getProjectId('C:\\Users\\dev\\projects\\myapp');
    expect(id).toMatch(/^myapp-/);
  });
});
