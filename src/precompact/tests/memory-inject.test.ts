import { describe, it, expect } from 'vitest';
import { formatMemoryContext } from '../memory-inject.js';
import type { MemoryItem } from '../../memory/types.js';

const makeMemory = (overrides: Partial<MemoryItem> = {}): MemoryItem => ({
  id: 'test-id',
  memory: 'Docker build fails on M1; use --platform linux/amd64',
  kind: 'fact',
  source: 'claude',
  project: 'global',
  created_at: '2026-01-01T00:00:00Z',
  ...overrides,
});

describe('formatMemoryContext', () => {
  it('renders section header', () => {
    const output = formatMemoryContext([makeMemory()]);
    expect(output).toContain('## Remembered Knowledge');
  });

  it('includes kind prefix in brackets', () => {
    const output = formatMemoryContext([makeMemory({ kind: 'constraint' })]);
    expect(output).toContain('[constraint]');
  });

  it('includes memory text', () => {
    const output = formatMemoryContext([makeMemory()]);
    expect(output).toContain('Docker build fails on M1; use --platform linux/amd64');
  });

  it('renders multiple memories as bullet list', () => {
    const memories = [
      makeMemory({ memory: 'First fact', kind: 'fact' }),
      makeMemory({ memory: 'Second fact', kind: 'convention' }),
    ];
    const output = formatMemoryContext(memories);
    expect(output).toContain('- [fact] First fact');
    expect(output).toContain('- [convention] Second fact');
  });

  it('always includes kind prefix for typed MemoryKind values', () => {
    const output = formatMemoryContext([makeMemory({ kind: 'fact' })]);
    expect(output).toContain('- [fact] Docker build fails');
  });

  it('includes footer with search_memory and add_memory hints', () => {
    const output = formatMemoryContext([makeMemory()]);
    expect(output).toContain('search_memory(query)');
    expect(output).toContain('add_memory');
  });
});
