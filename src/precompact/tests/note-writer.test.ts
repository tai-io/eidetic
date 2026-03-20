import { describe, it, expect, afterEach } from 'vitest';
import { formatSessionNote, writeSessionNote } from '../note-writer.js';
import { createTempCodebase, cleanupTempDir } from '../../__tests__/fixtures.js';
import type { ExtractedSession } from '../types.js';
import fs from 'node:fs';
import path from 'node:path';

const makeSession = (overrides: Partial<ExtractedSession> = {}): ExtractedSession => ({
  sessionId: 'abc12345-6789',
  projectName: 'myproject',
  projectPath: '/path/to/myproject',
  branch: 'feat/auth',
  startTime: '2026-02-19T10:00:00Z',
  endTime: '2026-02-19T11:30:00Z',
  filesModified: ['/src/auth.ts', '/src/middleware.ts'],
  bashCommands: ['npm test', 'npm run build'],
  mcpToolsCalled: ['search_code'],
  tasksCreated: ['Implement JWT'],
  tasksUpdated: ['Fix bug → completed'],
  userMessages: ['Add authentication'],
  trigger: 'auto',
  ...overrides,
});

describe('formatSessionNote', () => {
  it('includes YAML frontmatter with required fields', () => {
    const note = formatSessionNote(makeSession());
    expect(note).toContain('---');
    expect(note).toContain('project: myproject');
    expect(note).toContain('date: 2026-02-19');
    expect(note).toContain('branch: feat/auth');
    expect(note).toContain('trigger: auto');
  });

  it('includes session_id in frontmatter', () => {
    const note = formatSessionNote(makeSession());
    expect(note).toContain('session_id: abc12345-6789');
  });

  it('lists modified files in Changes section', () => {
    const note = formatSessionNote(makeSession());
    expect(note).toContain('## Changes');
    expect(note).toContain('- `/src/auth.ts`');
    expect(note).toContain('- `/src/middleware.ts`');
  });

  it('shows "No file modifications" when empty', () => {
    const note = formatSessionNote(makeSession({ filesModified: [] }));
    expect(note).toContain('No file modifications detected');
  });

  it('lists tasks in Tasks section', () => {
    const note = formatSessionNote(makeSession());
    expect(note).toContain('## Tasks');
    expect(note).toContain('- Created: Implement JWT');
    expect(note).toContain('- Updated: Fix bug → completed');
  });

  it('shows "No tasks" when both empty', () => {
    const note = formatSessionNote(makeSession({ tasksCreated: [], tasksUpdated: [] }));
    expect(note).toContain('No tasks created or updated');
  });

  it('lists bash commands in Commands section', () => {
    const note = formatSessionNote(makeSession());
    expect(note).toContain('## Commands');
    expect(note).toContain('- `npm test`');
    expect(note).toContain('- `npm run build`');
  });

  it('shows "No commands" when empty', () => {
    const note = formatSessionNote(makeSession({ bashCommands: [] }));
    expect(note).toContain('No commands recorded');
  });

  it('includes placeholder for Decisions section', () => {
    const note = formatSessionNote(makeSession());
    expect(note).toContain('## Decisions');
    expect(note).toContain('native auto memory');
  });

  it('includes placeholder for Open Questions section', () => {
    const note = formatSessionNote(makeSession());
    expect(note).toContain('## Open Questions');
    expect(note).toContain('project memory');
  });

  it('handles null branch', () => {
    const note = formatSessionNote(makeSession({ branch: null }));
    expect(note).toContain('branch: unknown');
    expect(note).toContain('**Branch:** unknown');
  });

  it('includes user requests section', () => {
    const note = formatSessionNote(makeSession({ userMessages: ['Do X', 'Then Y'] }));
    expect(note).toContain('## User Requests');
    expect(note).toContain('1. Do X');
    expect(note).toContain('2. Then Y');
  });

  it('includes MCP tools section when present', () => {
    const note = formatSessionNote(
      makeSession({ mcpToolsCalled: ['search_code', 'index_codebase'] }),
    );
    expect(note).toContain('## MCP Tools');
    expect(note).toContain('- search_code');
    expect(note).toContain('- index_codebase');
  });
});

describe('writeSessionNote', () => {
  let tmpDir: string;

  afterEach(() => {
    if (tmpDir) cleanupTempDir(tmpDir);
  });

  it('creates notes directory if missing', () => {
    tmpDir = createTempCodebase({});
    const notesDir = path.join(tmpDir, 'notes', 'project');
    writeSessionNote(notesDir, makeSession());
    expect(fs.existsSync(notesDir)).toBe(true);
  });

  it('writes file with correct date-auto-id naming', () => {
    tmpDir = createTempCodebase({});
    const notesDir = path.join(tmpDir, 'notes');
    const filePath = writeSessionNote(notesDir, makeSession());
    expect(path.basename(filePath)).toBe('2026-02-19-auto-abc12345.md');
  });

  it('file contains formatted note content', () => {
    tmpDir = createTempCodebase({});
    const notesDir = path.join(tmpDir, 'notes');
    const filePath = writeSessionNote(notesDir, makeSession());
    const content = fs.readFileSync(filePath, 'utf-8');
    expect(content).toContain('project: myproject');
    expect(content).toContain('## Changes');
  });

  it('extracts date from startTime correctly', () => {
    tmpDir = createTempCodebase({});
    const notesDir = path.join(tmpDir, 'notes');
    const session = makeSession({ startTime: '2026-03-15T14:30:00Z' });
    const filePath = writeSessionNote(notesDir, session);
    expect(path.basename(filePath)).toBe('2026-03-15-auto-abc12345.md');
  });

  it('uses fallback date when startTime is unknown', () => {
    tmpDir = createTempCodebase({});
    const notesDir = path.join(tmpDir, 'notes');
    const session = makeSession({ startTime: 'unknown' });
    const filePath = writeSessionNote(notesDir, session);
    // Should use current date - just check it has the auto- prefix
    expect(path.basename(filePath)).toMatch(/^\d{4}-\d{2}-\d{2}-auto-abc12345\.md$/);
  });
});
