import { describe, it, expect, beforeEach } from 'vitest';
import { MemoryBuffer, FLUSH_THRESHOLD } from '../buffer.js';
import { join } from 'node:path';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';

describe('MemoryBuffer', () => {
  let buffer: MemoryBuffer;

  beforeEach(() => {
    const tmpDir = mkdtempSync(join(tmpdir(), 'eidetic-buffer-test-'));
    buffer = new MemoryBuffer(join(tmpDir, 'buffer.db'));
  });

  describe('FLUSH_THRESHOLD', () => {
    it('is 20', () => {
      expect(FLUSH_THRESHOLD).toBe(20);
    });
  });

  describe('add', () => {
    it('inserts a buffer item', () => {
      buffer.add('sess-1', 'some fact', 'post-tool-extract', 'WebFetch', 'my-project');
      expect(buffer.count('sess-1')).toBe(1);
    });

    it('stores all fields correctly', () => {
      buffer.add('sess-1', 'URL returned 404', 'post-tool-extract', 'WebFetch', 'my-project');
      const items = buffer.flush('sess-1');
      expect(items).toHaveLength(1);
      expect(items[0]).toMatchObject({
        session_id: 'sess-1',
        content: 'URL returned 404',
        source: 'post-tool-extract',
        tool_name: 'WebFetch',
        project: 'my-project',
      });
      expect(items[0].id).toBeTypeOf('number');
      expect(items[0].captured_at).toBeTruthy();
    });

    it('allows null tool_name', () => {
      buffer.add('sess-1', 'explicit fact', 'user-explicit', null, 'global');
      const items = buffer.flush('sess-1');
      expect(items[0].tool_name).toBeNull();
    });
  });

  describe('count', () => {
    it('returns 0 for empty session', () => {
      expect(buffer.count('no-such-session')).toBe(0);
    });

    it('counts only items for the given session', () => {
      buffer.add('sess-1', 'fact-a', 'post-tool-extract', 'Bash', 'proj');
      buffer.add('sess-1', 'fact-b', 'post-tool-extract', 'Bash', 'proj');
      buffer.add('sess-2', 'fact-c', 'post-tool-extract', 'Bash', 'proj');
      expect(buffer.count('sess-1')).toBe(2);
      expect(buffer.count('sess-2')).toBe(1);
    });
  });

  describe('flush', () => {
    it('returns all items for session in insertion order', () => {
      buffer.add('sess-1', 'first', 'post-tool-extract', 'Bash', 'proj');
      buffer.add('sess-1', 'second', 'post-tool-extract', 'WebFetch', 'proj');
      const items = buffer.flush('sess-1');
      expect(items).toHaveLength(2);
      expect(items[0].content).toBe('first');
      expect(items[1].content).toBe('second');
    });

    it('returns empty array for unknown session', () => {
      expect(buffer.flush('unknown')).toEqual([]);
    });

    it('does not remove items (flush is read-only)', () => {
      buffer.add('sess-1', 'fact', 'post-tool-extract', 'Bash', 'proj');
      buffer.flush('sess-1');
      expect(buffer.count('sess-1')).toBe(1);
    });
  });

  describe('clear', () => {
    it('removes all items for the given session', () => {
      buffer.add('sess-1', 'fact-a', 'post-tool-extract', 'Bash', 'proj');
      buffer.add('sess-1', 'fact-b', 'post-tool-extract', 'Bash', 'proj');
      buffer.add('sess-2', 'fact-c', 'post-tool-extract', 'Bash', 'proj');
      buffer.clear('sess-1');
      expect(buffer.count('sess-1')).toBe(0);
      expect(buffer.count('sess-2')).toBe(1);
    });
  });

  describe('consolidation lock', () => {
    it('isConsolidating returns false initially', () => {
      expect(buffer.isConsolidating('sess-1')).toBe(false);
    });

    it('markConsolidating sets the lock', () => {
      buffer.markConsolidating('sess-1');
      expect(buffer.isConsolidating('sess-1')).toBe(true);
    });

    it('clearConsolidating releases the lock', () => {
      buffer.markConsolidating('sess-1');
      buffer.clearConsolidating('sess-1');
      expect(buffer.isConsolidating('sess-1')).toBe(false);
    });

    it('isConsolidating returns false for stale locks (>5 min)', () => {
      // Manually insert a stale lock
      buffer.markConsolidating('sess-1');
      // Override the timestamp to 6 minutes ago
      buffer['db']
        .prepare(`UPDATE buffer_sessions SET consolidating_since = ? WHERE session_id = ?`)
        .run(new Date(Date.now() - 6 * 60 * 1000).toISOString(), 'sess-1');
      expect(buffer.isConsolidating('sess-1')).toBe(false);
    });

    it('markConsolidating is idempotent when already locked', () => {
      buffer.markConsolidating('sess-1');
      buffer.markConsolidating('sess-1'); // should not throw
      expect(buffer.isConsolidating('sess-1')).toBe(true);
    });
  });

  describe('clearStaleItems', () => {
    it('removes items older than the given max age', () => {
      buffer.add('sess-1', 'old fact', 'post-tool-extract', 'Bash', 'proj');
      // Backdate the item to 7 hours ago
      buffer['db']
        .prepare(`UPDATE memory_buffer SET captured_at = ?`)
        .run(new Date(Date.now() - 7 * 60 * 60 * 1000).toISOString());
      const stale = buffer.clearStaleItems(6 * 60 * 60 * 1000); // 6 hours
      expect(stale).toHaveLength(1);
      expect(stale[0].content).toBe('old fact');
      expect(buffer.count('sess-1')).toBe(0);
    });

    it('leaves fresh items untouched', () => {
      buffer.add('sess-1', 'fresh fact', 'post-tool-extract', 'Bash', 'proj');
      const stale = buffer.clearStaleItems(6 * 60 * 60 * 1000);
      expect(stale).toHaveLength(0);
      expect(buffer.count('sess-1')).toBe(1);
    });
  });
});
