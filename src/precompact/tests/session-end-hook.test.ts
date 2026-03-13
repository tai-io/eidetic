import { describe, it, expect, afterEach } from 'vitest';
import path from 'node:path';
import { createTempCodebase, cleanupTempDir } from '../../__tests__/fixtures.js';
import { parseTranscript } from '../transcript-parser.js';
import { writeSessionNote } from '../note-writer.js';
import { updateSessionIndex, readSessionIndex } from '../tier0-writer.js';

// SessionEnd hook tests validate the components used by the generalized hook:
// - Dedup check using readSessionIndex
// - Content assembly for memory extraction
// - Graceful failure behavior

describe('SessionEnd hook components', () => {
  let tmpDir: string;

  afterEach(() => {
    if (tmpDir) cleanupTempDir(tmpDir);
  });

  describe('dedup check', () => {
    it('detects session already captured by PreCompact', async () => {
      tmpDir = createTempCodebase({
        'transcript.jsonl': [
          '{"type":"user","timestamp":"2026-02-19T10:00:00Z","gitBranch":"main","message":{"role":"user","content":[{"type":"text","text":"Fix the bug"}]}}',
        ].join('\n'),
      });

      const notesDir = path.join(tmpDir, 'notes');
      const session = await parseTranscript(
        path.join(tmpDir, 'transcript.jsonl'),
        'precompact-session-id',
        'testproj',
        tmpDir,
        'auto',
      );

      // Simulate PreCompact already captured this session
      const noteFile = writeSessionNote(notesDir, session);
      updateSessionIndex(notesDir, session, noteFile);

      // SessionEnd dedup check
      const index = readSessionIndex(notesDir);
      const alreadyCaptured =
        index?.sessions.some((s) => s.sessionId === 'precompact-session-id') ?? false;

      expect(alreadyCaptured).toBe(true);
    });

    it('does not flag a different session as already captured', async () => {
      tmpDir = createTempCodebase({
        'transcript.jsonl':
          '{"type":"user","timestamp":"2026-02-19T10:00:00Z","message":{"content":[]}}',
      });

      const notesDir = path.join(tmpDir, 'notes');
      const session = await parseTranscript(
        path.join(tmpDir, 'transcript.jsonl'),
        'session-a',
        'testproj',
        tmpDir,
        'auto',
      );
      const noteFile = writeSessionNote(notesDir, session);
      updateSessionIndex(notesDir, session, noteFile);

      // Check for a different session ID (SessionEnd for a different session)
      const index = readSessionIndex(notesDir);
      const alreadyCaptured = index?.sessions.some((s) => s.sessionId === 'session-b') ?? false;

      expect(alreadyCaptured).toBe(false);
    });

    it('returns false when no index exists yet', () => {
      tmpDir = createTempCodebase({});
      const notesDir = path.join(tmpDir, 'notes');

      const index = readSessionIndex(notesDir);
      const alreadyCaptured = index?.sessions.some((s) => s.sessionId === 'any-id') ?? false;

      expect(alreadyCaptured).toBe(false);
    });
  });

  describe('memory content assembly', () => {
    it('assembles content from session with user messages and files', async () => {
      tmpDir = createTempCodebase({
        'transcript.jsonl': [
          '{"type":"user","timestamp":"2026-02-19T10:00:00Z","gitBranch":"feat/foo","message":{"role":"user","content":[{"type":"text","text":"I always use tabs"}]}}',
          '{"type":"assistant","timestamp":"2026-02-19T10:01:00Z","message":{"content":[{"type":"tool_use","name":"Write","input":{"file_path":"/src/foo.ts"}}]}}',
          '{"type":"assistant","timestamp":"2026-02-19T10:02:00Z","message":{"content":[{"type":"tool_use","name":"TaskCreate","input":{"subject":"My task"}}]}}',
        ].join('\n'),
      });

      const session = await parseTranscript(
        path.join(tmpDir, 'transcript.jsonl'),
        'content-session',
        'testproj',
        tmpDir,
        'session_end',
      );

      // Verify session contains expected data for content assembly
      expect(session.userMessages).toContain('I always use tabs');
      expect(session.filesModified).toContain('/src/foo.ts');
      expect(session.tasksCreated).toContain('My task');
      expect(session.branch).toBe('feat/foo');
      expect(session.trigger).toBe('session_end');
    });

    it('handles session with no user messages gracefully', async () => {
      tmpDir = createTempCodebase({
        'transcript.jsonl':
          '{"type":"system","timestamp":"2026-02-19T10:00:00Z","message":{"content":[]}}',
      });

      const session = await parseTranscript(
        path.join(tmpDir, 'transcript.jsonl'),
        'empty-session',
        'testproj',
        tmpDir,
        'session_end',
      );

      expect(session.userMessages).toEqual([]);
      expect(session.filesModified).toEqual([]);
    });
  });

  describe('SessionEnd note writing', () => {
    it('writes note with session_end trigger', async () => {
      tmpDir = createTempCodebase({
        'transcript.jsonl': [
          '{"type":"user","timestamp":"2026-02-19T10:00:00Z","message":{"role":"user","content":[{"type":"text","text":"Hello"}]}}',
        ].join('\n'),
      });

      const notesDir = path.join(tmpDir, 'notes');
      const session = await parseTranscript(
        path.join(tmpDir, 'transcript.jsonl'),
        'end-session',
        'testproj',
        tmpDir,
        'session_end',
      );

      const noteFile = writeSessionNote(notesDir, session);
      updateSessionIndex(notesDir, session, noteFile);

      const index = readSessionIndex(notesDir);
      expect(index).not.toBeNull();
      expect(index!.sessions[0].trigger).toBe('session_end');
      expect(index!.sessions[0].sessionId).toBe('end-session');
    });
  });
});
