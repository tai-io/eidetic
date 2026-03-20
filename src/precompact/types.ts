/**
 * Types for PreCompact hook - automatic session persistence before context compaction.
 */

/**
 * Session data extracted from transcript JSONL.
 * Contains deterministic data parsed directly from tool calls.
 */
export interface ExtractedSession {
  sessionId: string;
  projectName: string;
  projectPath: string;
  branch: string | null;
  startTime: string;
  endTime: string;
  filesModified: string[];
  bashCommands: string[];
  mcpToolsCalled: string[];
  tasksCreated: string[];
  tasksUpdated: string[];
  userMessages: string[];
  trigger: 'auto' | 'manual' | 'session_end';
}

/**
 * Compact session record for Tier-0 fast lookup.
 * Stored in .session-index.json for instant SessionStart injection.
 */
export interface Tier0Record {
  sessionId: string;
  date: string;
  branch: string | null;
  filesModified: string[];
  tasksCreated: string[];
  trigger: 'auto' | 'manual' | 'session_end';
  noteFile: string;
}

/**
 * Session index for a project - enables fast SessionStart context injection.
 * Stored at ~/.eidetic/notes/<project>/.session-index.json
 */
export interface SessionIndex {
  project: string;
  sessions: Tier0Record[];
  lastUpdated: string;
}

/**
 * A single line from the Claude Code transcript JSONL.
 */
export interface TranscriptLine {
  type: 'user' | 'assistant' | 'system';
  timestamp?: string;
  gitBranch?: string;
  message?: {
    role?: string;
    content?: TranscriptContent[];
  };
}

/**
 * Content block within a transcript message.
 */
export type TranscriptContent =
  | { type: 'text'; text: string }
  | { type: 'tool_use'; id: string; name: string; input: Record<string, unknown> }
  | { type: 'tool_result'; tool_use_id: string; content: unknown };
