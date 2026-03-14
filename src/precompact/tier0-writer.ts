/**
 * Maintain .session-index.json for Tier-0 fast SessionStart context injection.
 */

import fs from 'node:fs';
import path from 'node:path';
import type { ExtractedSession, SessionIndex, Tier0Record } from './types.js';
import { extractDate, writeFileAtomic } from './utils.js';

const MAX_SESSIONS = 10;
const INDEX_FILENAME = '.session-index.json';

/**
 * Update the session index with a new session record.
 * Prepends the new session and keeps only the last 10.
 * Uses atomic write to prevent corruption from concurrent access.
 */
export function updateSessionIndex(
  notesDir: string,
  session: ExtractedSession,
  noteFile: string,
): void {
  const indexPath = path.join(notesDir, INDEX_FILENAME);

  // Load existing index or create new
  let index: SessionIndex;
  if (fs.existsSync(indexPath)) {
    try {
      const content = fs.readFileSync(indexPath, 'utf-8');
      index = JSON.parse(content) as SessionIndex;
    } catch {
      // Corrupted index, start fresh
      index = createEmptyIndex(session.projectName);
    }
  } else {
    index = createEmptyIndex(session.projectName);
  }

  // Create new record
  const record: Tier0Record = {
    sessionId: session.sessionId,
    date: extractDate(session.startTime),
    branch: session.branch,
    filesModified: session.filesModified,
    tasksCreated: session.tasksCreated,
    trigger: session.trigger,
    noteFile,
  };

  // Prepend new session and trim to max
  index.sessions = [record, ...index.sessions].slice(0, MAX_SESSIONS);
  index.project = session.projectName;
  index.lastUpdated = new Date().toISOString();

  // Ensure directory exists
  fs.mkdirSync(notesDir, { recursive: true });

  // Write atomically to prevent corruption from concurrent hooks
  writeFileAtomic(indexPath, JSON.stringify(index, null, 2));
}

/**
 * Read the session index for a project.
 * Returns null if not found or corrupted.
 */
export function readSessionIndex(notesDir: string): SessionIndex | null {
  const indexPath = path.join(notesDir, INDEX_FILENAME);
  if (!fs.existsSync(indexPath)) {
    return null;
  }
  try {
    const content = fs.readFileSync(indexPath, 'utf-8');
    return JSON.parse(content) as SessionIndex;
  } catch {
    return null;
  }
}

function createEmptyIndex(project: string): SessionIndex {
  return {
    project,
    sessions: [],
    lastUpdated: new Date().toISOString(),
  };
}
