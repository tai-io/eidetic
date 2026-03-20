/**
 * Format and write session notes compatible with /wrapup and /catchup.
 */

import fs from 'node:fs';
import path from 'node:path';
import type { ExtractedSession } from './types.js';
import { extractDate, writeFileAtomic } from './utils.js';

/**
 * Format an extracted session as a markdown note.
 * Output format matches /wrapup template for /catchup compatibility.
 */
export function formatSessionNote(session: ExtractedSession): string {
  const date = extractDate(session.startTime);
  const branch = session.branch ?? 'unknown';

  const lines: string[] = [];

  // YAML frontmatter
  lines.push('---');
  lines.push(`project: ${session.projectName}`);
  lines.push(`date: ${date}`);
  lines.push(`branch: ${branch}`);
  lines.push(`session_id: ${session.sessionId}`);
  lines.push(`trigger: ${session.trigger}`);
  lines.push('---');
  lines.push('');

  // Header
  lines.push(`# ${session.projectName} — ${date}: Auto-captured session`);
  lines.push('');
  lines.push(`**Date:** ${date}`);
  lines.push(`**Project:** ${session.projectName}`);
  lines.push(`**Branch:** ${branch}`);
  lines.push('');

  // User Requests
  if (session.userMessages.length > 0) {
    lines.push('## User Requests');
    session.userMessages.forEach((msg, i) => {
      lines.push(`${i + 1}. ${msg}`);
    });
    lines.push('');
  }

  // Changes
  lines.push('## Changes');
  if (session.filesModified.length > 0) {
    session.filesModified.forEach((file) => {
      lines.push(`- \`${file}\``);
    });
  } else {
    lines.push('*No file modifications detected.*');
  }
  lines.push('');

  // Tasks
  lines.push('## Tasks');
  if (session.tasksCreated.length > 0 || session.tasksUpdated.length > 0) {
    session.tasksCreated.forEach((task) => {
      lines.push(`- Created: ${task}`);
    });
    session.tasksUpdated.forEach((task) => {
      lines.push(`- Updated: ${task}`);
    });
  } else {
    lines.push('*No tasks created or updated.*');
  }
  lines.push('');

  // Commands
  lines.push('## Commands');
  if (session.bashCommands.length > 0) {
    session.bashCommands.forEach((cmd) => {
      lines.push(`- \`${cmd}\``);
    });
  } else {
    lines.push('*No commands recorded.*');
  }
  lines.push('');

  // MCP Tools
  if (session.mcpToolsCalled.length > 0) {
    lines.push('## MCP Tools');
    session.mcpToolsCalled.forEach((tool) => {
      lines.push(`- ${tool}`);
    });
    lines.push('');
  }

  // Decisions (placeholder)
  lines.push('## Decisions');
  lines.push('*Auto-captured. Use native auto memory to persist decisions with rationale.*');
  lines.push('');

  // Open Questions (placeholder)
  lines.push('## Open Questions');
  lines.push('*Add open questions to project memory for cross-session tracking.*');
  lines.push('');

  return lines.join('\n');
}

/**
 * Write a session note to disk.
 * Returns the full path to the written file.
 */
export function writeSessionNote(notesDir: string, session: ExtractedSession): string {
  // Ensure directory exists
  fs.mkdirSync(notesDir, { recursive: true });

  const date = extractDate(session.startTime);
  const shortId = session.sessionId.slice(0, 8);
  const filename = `${date}-auto-${shortId}.md`;
  const filePath = path.join(notesDir, filename);

  const content = formatSessionNote(session);
  // Use atomic write for note files (less critical than index, but still good)
  writeFileAtomic(filePath, content);

  return filePath;
}
