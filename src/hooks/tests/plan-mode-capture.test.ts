import { describe, it, expect, afterEach } from 'vitest';
import path from 'node:path';
import { createTempCodebase, cleanupTempDir } from '../../__tests__/fixtures.js';
import { parseTranscript } from '../../precompact/transcript-parser.js';
import { writeSessionNote } from '../../precompact/note-writer.js';
import { updateSessionIndex, readSessionIndex } from '../../precompact/tier0-writer.js';

// Plan mode capture tests validate the components used by the PreToolUse hook:
// - Session capture on plan mode transition
// - Dedup with existing captures (PreCompact, SessionEnd, previous plan-mode)

describe('Plan mode capture components', () => {
  let tmpDir: string;

  afterEach(() => {
    if (tmpDir) cleanupTempDir(tmpDir);
  });

  it('captures session state on plan mode transition', async () => {
    tmpDir = createTempCodebase({
      'transcript.jsonl': [
        '{"type":"user","timestamp":"2026-03-14T10:00:00Z","gitBranch":"feature/auth","message":{"role":"user","content":[{"type":"text","text":"Add login endpoint"}]}}',
        '{"type":"assistant","timestamp":"2026-03-14T10:01:00Z","message":{"content":[{"type":"tool_use","name":"Write","input":{"file_path":"/src/auth.ts"}}]}}',
        '{"type":"assistant","timestamp":"2026-03-14T10:02:00Z","message":{"content":[{"type":"tool_use","name":"Bash","input":{"command":"npm test"}}]}}',
      ].join('\n'),
    });

    const notesDir = path.join(tmpDir, 'notes');
    const session = await parseTranscript(
      path.join(tmpDir, 'transcript.jsonl'),
      'plan-mode-session',
      'testproj',
      tmpDir,
      'auto',
    );

    const noteFile = writeSessionNote(notesDir, session);
    updateSessionIndex(notesDir, session, noteFile);

    const index = readSessionIndex(notesDir);
    expect(index).not.toBeNull();
    expect(index!.sessions[0].sessionId).toBe('plan-mode-session');
    expect(index!.sessions[0].filesModified).toContain('/src/auth.ts');
    expect(session.userMessages).toContain('Add login endpoint');
    expect(session.branch).toBe('feature/auth');
  });

  it('skips capture when session already captured by PreCompact', async () => {
    tmpDir = createTempCodebase({
      'transcript.jsonl':
        '{"type":"user","timestamp":"2026-03-14T10:00:00Z","message":{"content":[]}}',
    });

    const notesDir = path.join(tmpDir, 'notes');
    const session = await parseTranscript(
      path.join(tmpDir, 'transcript.jsonl'),
      'already-captured',
      'testproj',
      tmpDir,
      'auto',
    );

    // Simulate PreCompact already captured this session
    const noteFile = writeSessionNote(notesDir, session);
    updateSessionIndex(notesDir, session, noteFile);

    // Plan mode capture dedup check
    const existingIndex = readSessionIndex(notesDir);
    const alreadyCaptured =
      existingIndex?.sessions.some((s) => s.sessionId === 'already-captured') ?? false;

    expect(alreadyCaptured).toBe(true);
  });

  it('captures when no prior capture exists', () => {
    tmpDir = createTempCodebase({});
    const notesDir = path.join(tmpDir, 'notes');

    const index = readSessionIndex(notesDir);
    const alreadyCaptured = index?.sessions.some((s) => s.sessionId === 'new-session') ?? false;

    expect(alreadyCaptured).toBe(false);
  });
});
