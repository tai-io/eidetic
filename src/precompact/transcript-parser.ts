/**
 * Parse Claude Code transcript JSONL to extract session data.
 * Extracts deterministic data from tool calls - no LLM needed.
 */

import fs from 'node:fs';
import readline from 'node:readline';
import type { ExtractedSession, TranscriptLine } from './types.js';
import { truncateUnicode } from './utils.js';

const MAX_BASH_COMMANDS = 20;
const MAX_USER_MESSAGES = 5;
const BASH_COMMAND_MAX_LENGTH = 120;
const USER_MESSAGE_MAX_LENGTH = 200;

/**
 * Parse a transcript JSONL file and extract session data.
 */
export async function parseTranscript(
  transcriptPath: string,
  sessionId: string,
  projectName: string,
  projectPath: string,
  trigger: 'auto' | 'manual' | 'session_end' = 'auto',
): Promise<ExtractedSession> {
  const filesModified = new Set<string>();
  const bashCommands: string[] = [];
  const mcpToolsCalled = new Set<string>();
  const tasksCreated: string[] = [];
  const tasksUpdated: string[] = [];
  const taskIdToSubject = new Map<string, string>();
  const userMessages: string[] = [];

  let branch: string | null = null;
  let startTime: string | null = null;
  let endTime: string | null = null;

  const fileStream = fs.createReadStream(transcriptPath);
  const rl = readline.createInterface({
    input: fileStream,
    crlfDelay: Infinity,
  });

  for await (const line of rl) {
    if (!line.trim()) continue;

    let parsed: TranscriptLine;
    try {
      parsed = JSON.parse(line) as TranscriptLine;
    } catch {
      // Skip malformed JSON lines
      continue;
    }

    // Extract timestamps
    if (parsed.timestamp) {
      startTime ??= parsed.timestamp;
      endTime = parsed.timestamp;
    }

    // Extract git branch from first entry that has it
    if (!branch && parsed.gitBranch) {
      branch = parsed.gitBranch;
    }

    // Extract user messages
    if (parsed.type === 'user' && userMessages.length < MAX_USER_MESSAGES) {
      const text = extractUserText(parsed);
      if (text) {
        userMessages.push(truncateUnicode(text, USER_MESSAGE_MAX_LENGTH));
      }
    }

    // Extract tool calls from assistant messages
    if (parsed.type === 'assistant' && parsed.message?.content) {
      for (const content of parsed.message.content) {
        if (content.type !== 'tool_use') continue;

        const toolContent = content as {
          type: 'tool_use';
          name: string;
          input: Record<string, unknown>;
        };
        processToolCall(toolContent, {
          filesModified,
          bashCommands,
          mcpToolsCalled,
          tasksCreated,
          tasksUpdated,
          taskIdToSubject,
        });
      }
    }
  }

  return {
    sessionId,
    projectName,
    projectPath,
    branch,
    startTime: startTime ?? 'unknown',
    endTime: endTime ?? 'unknown',
    filesModified: Array.from(filesModified).sort(),
    bashCommands,
    mcpToolsCalled: Array.from(mcpToolsCalled).sort(),
    tasksCreated,
    tasksUpdated,
    userMessages,
    trigger,
  };
}

interface ExtractState {
  filesModified: Set<string>;
  bashCommands: string[];
  mcpToolsCalled: Set<string>;
  tasksCreated: string[];
  tasksUpdated: string[];
  taskIdToSubject: Map<string, string>;
}

function processToolCall(
  content: { type: 'tool_use'; name: string; input: Record<string, unknown> },
  state: ExtractState,
): void {
  const { name, input } = content;

  // File modifications
  if (name === 'Write' || name === 'Edit') {
    const filePath = input.file_path;
    if (typeof filePath === 'string') {
      state.filesModified.add(filePath);
    }
  }

  // Bash commands (enforce limit during collection)
  if (name === 'Bash' && state.bashCommands.length < MAX_BASH_COMMANDS) {
    const command = input.command;
    if (typeof command === 'string') {
      state.bashCommands.push(truncateUnicode(command, BASH_COMMAND_MAX_LENGTH));
    }
  }

  // Task operations - track subject by taskId for later updates
  if (name === 'TaskCreate') {
    const subject = input.subject;
    const taskId = input.taskId;
    if (typeof subject === 'string') {
      state.tasksCreated.push(subject);
      // Track subject by taskId if available (for future TaskUpdate lookups)
      if (typeof taskId === 'string') {
        state.taskIdToSubject.set(taskId, subject);
      }
    }
  }

  if (name === 'TaskUpdate') {
    const taskId = input.taskId;
    const status = input.status;
    // Try to get subject from input first, then from tracked tasks
    let subject = input.subject;
    if (typeof subject !== 'string' && typeof taskId === 'string') {
      subject = state.taskIdToSubject.get(taskId);
    }
    if (typeof subject === 'string' && typeof status === 'string') {
      state.tasksUpdated.push(`${subject} → ${status}`);
    }
  }

  // MCP tools
  if (name.startsWith('mcp__')) {
    state.mcpToolsCalled.add(name);
  }
}

function extractUserText(line: TranscriptLine): string | null {
  const content = line.message?.content;
  if (!Array.isArray(content)) return null;

  for (const block of content) {
    if (block.type === 'text' && typeof block.text === 'string') {
      return block.text;
    }
  }
  return null;
}
