import { describe, it, expect, beforeEach } from 'vitest';
import { MemoryHistory } from '../history.js';
import { join } from 'node:path';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';

describe('MemoryHistory', () => {
  let history: MemoryHistory;

  beforeEach(() => {
    const tmpDir = mkdtempSync(join(tmpdir(), 'eidetic-history-test-'));
    history = new MemoryHistory(join(tmpDir, 'test.db'));
  });

  it('logs and retrieves ADD events', () => {
    history.log('mem-1', 'ADD', 'I prefer tabs', null, 'add', '2026-02-21T10:00:00Z');

    const entries = history.getHistory('mem-1');
    expect(entries).toHaveLength(1);
    expect(entries[0].memory_id).toBe('mem-1');
    expect(entries[0].event).toBe('ADD');
    expect(entries[0].new_value).toBe('I prefer tabs');
    expect(entries[0].previous_value).toBeNull();
    expect(entries[0].source).toBe('add');
    expect(entries[0].created_at).toBeTruthy();
    expect(entries[0].updated_at).toBe('2026-02-21T10:00:00Z');
  });

  it('logs MERGE events with previous value', () => {
    history.log('mem-2', 'ADD', 'I use Vitest', null);
    history.log('mem-2', 'MERGE', 'I use Jest', 'I use Vitest');

    const entries = history.getHistory('mem-2');
    expect(entries).toHaveLength(2);
    expect(entries[1].event).toBe('MERGE');
    expect(entries[1].new_value).toBe('I use Jest');
    expect(entries[1].previous_value).toBe('I use Vitest');
  });

  it('logs DELETE events', () => {
    history.log('mem-3', 'ADD', 'Something', null);
    history.log('mem-3', 'DELETE', null, 'Something');

    const entries = history.getHistory('mem-3');
    expect(entries).toHaveLength(2);
    expect(entries[1].event).toBe('DELETE');
    expect(entries[1].new_value).toBeNull();
    expect(entries[1].previous_value).toBe('Something');
    expect(entries[1].updated_at).toBeNull();
  });

  it('returns empty array for unknown memory ID', () => {
    const entries = history.getHistory('does-not-exist');
    expect(entries).toHaveLength(0);
  });

  it('returns entries in chronological order', () => {
    history.log('mem-4', 'ADD', 'v1', null);
    history.log('mem-4', 'MERGE', 'v2', 'v1');
    history.log('mem-4', 'MERGE', 'v3', 'v2');

    const entries = history.getHistory('mem-4');
    expect(entries).toHaveLength(3);
    expect(entries[0].event).toBe('ADD');
    expect(entries[1].event).toBe('MERGE');
    expect(entries[2].event).toBe('MERGE');
    expect(entries[2].new_value).toBe('v3');
  });
});
