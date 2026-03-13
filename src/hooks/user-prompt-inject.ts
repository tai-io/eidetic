#!/usr/bin/env node
/**
 * UserPromptSubmit hook: inject relevant global concepts into the conversation.
 *
 * Reads stdin JSON (user prompt + cwd), embeds the prompt, searches global concepts,
 * and outputs matching knowledge as additionalContext.
 */

import { execSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import type { UserPromptSubmitOutput, SimpleHookOutput } from './hook-output.js';

const TIMEOUT_MS = 3000;
const SEARCH_LIMIT = 5;

type HookResult = UserPromptSubmitOutput | SimpleHookOutput;

const EMPTY_RESULT: SimpleHookOutput = {};

interface UserPromptSubmitInput {
  session_id?: string;
  cwd?: string;
  user_prompt?: string;
  hook_event_name?: string;
}

export async function run(): Promise<void> {
  // Race with timeout
  const result = await Promise.race([doWork(), timeout(TIMEOUT_MS)]);
  process.stdout.write(JSON.stringify(result) + '\n');
}

async function timeout(ms: number): Promise<HookResult> {
  return new Promise((resolve) => {
    setTimeout(() => {
      resolve(EMPTY_RESULT);
    }, ms);
  });
}

async function doWork(): Promise<HookResult> {
  let input: UserPromptSubmitInput;
  try {
    const raw = await readStdin();
    input = JSON.parse(raw) as UserPromptSubmitInput;
  } catch {
    return EMPTY_RESULT;
  }

  if (input.hook_event_name !== 'UserPromptSubmit') {
    return EMPTY_RESULT;
  }

  const userPrompt = input.user_prompt ?? '';
  if (!userPrompt.trim()) {
    return EMPTY_RESULT;
  }

  try {
    const cwd = input.cwd;
    if (!cwd) {
      return EMPTY_RESULT;
    }
    const projectPath = detectProjectRoot(cwd);
    if (!projectPath) {
      return EMPTY_RESULT;
    }

    const projectName = path.basename(projectPath);
    const sessionId = input.session_id ?? 'unknown';

    // Write user query to buffer for memory extraction (survives abrupt close)
    try {
      const { getBufferDbPath } = await import('../paths.js');
      const { MemoryBuffer } = await import('../memory/buffer.js');
      const buffer = new MemoryBuffer(getBufferDbPath());
      buffer.add(sessionId, userPrompt, 'user-query', null, projectName);
    } catch {
      // Best effort — don't block the hook response
    }

    // Search existing memories for relevant context
    const [
      { loadConfig },
      { createEmbedding },
      { MemoryHistory },
      { MemoryStore },
      { QueryMemoryDB },
      { getMemoryDbPath, getMemoryStorePath },
    ] = await Promise.all([
      import('../config.js'),
      import('../embedding/factory.js'),
      import('../memory/history.js'),
      import('../memory/store.js'),
      import('../memory/query-memorydb.js'),
      import('../paths.js'),
    ]);

    const config = loadConfig();
    const embedding = createEmbedding(config);
    await embedding.initialize();

    const memorydb = new QueryMemoryDB(getMemoryStorePath());
    const history = new MemoryHistory(getMemoryDbPath());
    const store = new MemoryStore(embedding, memorydb, history);

    const memories = await store.searchMemory(userPrompt, SEARCH_LIMIT, undefined, projectName);

    if (memories.length === 0) {
      return EMPTY_RESULT;
    }

    const lines = memories.map((m) => `- [${m.kind}] ${m.memory}`);
    const additionalContext = `## Relevant Memories\n${lines.join('\n')}`;

    return {
      hookSpecificOutput: {
        hookEventName: 'UserPromptSubmit',
        additionalContext,
      },
    };
  } catch (err) {
    process.stderr.write(`user-prompt-inject failed: ${String(err)}\n`);
    return EMPTY_RESULT;
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

function readStdin(): Promise<string> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    process.stdin.on('data', (chunk: Buffer) => chunks.push(chunk));
    process.stdin.on('end', () => {
      resolve(Buffer.concat(chunks).toString('utf-8'));
    });
    process.stdin.on('error', reject);
  });
}

// CLI router calls run() directly; self-execute when run as standalone script
if (process.argv[1] === fileURLToPath(import.meta.url)) {
  void run();
}
