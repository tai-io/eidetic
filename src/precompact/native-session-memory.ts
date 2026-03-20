/**
 * Write a brief session summary to the native memory dir as a safety net.
 *
 * Overwrites a single `_last_session.md` file each time — not an append.
 * This ensures that even if auto memory misses something, a compact session
 * summary persists in the native memory dir for the cross-project index.
 */

import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import type { ExtractedSession } from './types.js';
import { extractDate, writeFileAtomic } from './utils.js';

const FILENAME = '_last_session.md';
const MAX_FILES = 8;
const MAX_REQUESTS = 5;

/**
 * Resolve the native memory dir for the current Claude project.
 * Returns null if CLAUDE_PROJECT is not set.
 */
function resolveNativeMemoryDir(): string | null {
  const project = process.env.CLAUDE_PROJECT;
  if (!project) return null;

  return path.join(os.homedir(), '.claude', 'projects', project, 'memory');
}

/**
 * Write a compact session summary to the native memory dir.
 * Overwrites the previous `_last_session.md`.
 */
export function writeNativeSessionMemory(session: ExtractedSession): void {
  const memoryDir = resolveNativeMemoryDir();
  if (!memoryDir) return;

  // Only write if there's something meaningful
  if (session.filesModified.length === 0 && session.userMessages.length === 0) return;

  fs.mkdirSync(memoryDir, { recursive: true });

  const date = extractDate(session.startTime);
  const branch = session.branch ?? 'unknown';
  const files = session.filesModified.slice(0, MAX_FILES);
  const requests = session.userMessages.slice(0, MAX_REQUESTS);

  const lines: string[] = [];
  lines.push('---');
  lines.push('name: last_session_summary');
  lines.push(`description: Auto-captured session summary from ${date} on branch ${branch}`);
  lines.push('type: project');
  lines.push('---');
  lines.push('');
  lines.push(`Session on ${date}, branch: ${branch}`);
  lines.push('');

  if (requests.length > 0) {
    lines.push('## What was worked on');
    for (const req of requests) {
      lines.push(`- ${req}`);
    }
    lines.push('');
  }

  if (files.length > 0) {
    lines.push('## Files modified');
    for (const file of files) {
      lines.push(`- \`${file}\``);
    }
    if (session.filesModified.length > MAX_FILES) {
      lines.push(`- (+${session.filesModified.length - MAX_FILES} more)`);
    }
    lines.push('');
  }

  if (session.tasksCreated.length > 0) {
    lines.push('## Tasks');
    for (const task of session.tasksCreated) {
      lines.push(`- ${task}`);
    }
    lines.push('');
  }

  const filePath = path.join(memoryDir, FILENAME);
  writeFileAtomic(filePath, lines.join('\n'));
}
