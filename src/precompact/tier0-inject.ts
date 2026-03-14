#!/usr/bin/env node
/**
 * Inject Tier-0 context at SessionStart.
 * Called by session-start hook to output compact session summary.
 *
 * Outputs to stdout for hook to capture and inject into session.
 */

import { execSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { readSessionIndex } from './tier0-writer.js';
import { getNotesDir, getProjectId } from './utils.js';

const MAX_FILES_SHOWN = 5;

export function run(): void {
  try {
    // Get cwd from environment (set by Claude Code) or detect from git
    const cwd = process.env.CLAUDE_CWD ?? process.cwd();

    // Detect project root from git
    const projectPath = detectProjectRoot(cwd);
    if (!projectPath) {
      // Not in a git repo, nothing to inject
      return;
    }

    // Use consistent project ID (handles name collisions)
    const projectId = getProjectId(projectPath);
    const notesDir = getNotesDir(projectId);

    // Read session index
    const index = readSessionIndex(notesDir);
    if (!index || index.sessions.length === 0) {
      // No previous sessions
      return;
    }

    // Get most recent session
    const latest = index.sessions[0];

    // Format compact output (~50 tokens)
    const output = formatTier0Context(latest, index.sessions.length);
    process.stdout.write(output);
  } catch (err) {
    // Write to stderr for debugging, but don't break session start
    process.stderr.write(`Tier-0 inject failed: ${String(err)}\n`);
  }
}

function detectProjectRoot(cwd: string): string | null {
  try {
    const result = execSync('git rev-parse --show-toplevel', {
      cwd,
      encoding: 'utf-8',
      stdio: ['pipe', 'pipe', 'pipe'],
    });
    return result.trim();
  } catch {
    return null;
  }
}

function formatTier0Context(
  session: {
    date: string;
    branch: string | null;
    filesModified: string[];
    tasksCreated: string[];
  },
  totalSessions: number,
): string {
  const lines: string[] = [];

  lines.push(`## Eidetic: Last session (${session.date}, branch: ${session.branch ?? 'unknown'})`);

  // Files modified
  if (session.filesModified.length > 0) {
    const shown = session.filesModified.slice(0, MAX_FILES_SHOWN);
    const remaining = session.filesModified.length - shown.length;
    const fileList = shown.map((f) => path.basename(f)).join(', ');
    if (remaining > 0) {
      lines.push(`- Files modified: ${fileList} (+${remaining} more)`);
    } else {
      lines.push(`- Files modified: ${fileList}`);
    }
  }

  // Tasks
  if (session.tasksCreated.length > 0) {
    lines.push(`- Tasks: ${session.tasksCreated.join(', ')}`);
  }

  // Prompt for more
  if (totalSessions > 1) {
    lines.push(`- Run /catchup for full context (${totalSessions} sessions available).`);
  } else {
    lines.push('- Run /catchup for full context.');
  }

  lines.push('');

  return lines.join('\n');
}

// Export for testing
export { formatTier0Context, detectProjectRoot };

// CLI router calls run() directly; self-execute when run as standalone script
if (process.argv[1] === fileURLToPath(import.meta.url)) {
  run();
}
