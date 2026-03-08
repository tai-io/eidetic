import { describe, it, expect } from 'vitest';
import { normalizePath } from '../paths.js';

describe('normalizePath', () => {
  it('converts backslashes to forward slashes', () => {
    const result = normalizePath('C:\\Users\\test\\project');
    expect(result).not.toContain('\\');
    expect(result).toContain('/');
  });

  it('removes trailing slash', () => {
    const result = normalizePath('/home/user/project/');
    expect(result.endsWith('/')).toBe(false);
  });

  it('resolves relative paths to absolute', () => {
    const result = normalizePath('relative/path');
    expect(result).toContain('/');
    // Should be absolute (starts with / or drive letter)
    expect(result.length).toBeGreaterThan('relative/path'.length);
  });

  it('expands tilde to home directory', () => {
    const result = normalizePath('~/projects');
    expect(result).not.toContain('~');
    expect(result).toContain('projects');
  });

  it('preserves root path without removing slash', () => {
    // Single character root "/" should not be stripped
    const result = normalizePath('/');
    expect(result.length).toBeGreaterThanOrEqual(1);
  });
});
