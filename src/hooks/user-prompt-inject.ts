#!/usr/bin/env node
/**
 * UserPromptSubmit hook: inject relevant global concepts into the conversation.
 *
 * Reads stdin JSON (user prompt + cwd), embeds the prompt, searches global concepts,
 * and outputs matching knowledge as additionalContext.
 */

import { execSync } from 'node:child_process';
import type { UserPromptSubmitOutput, SimpleHookOutput } from './hook-output.js';

const TIMEOUT_MS = 3000;
const SEARCH_LIMIT = 5;
const SCORE_THRESHOLD = 0.3;

type HookResult = UserPromptSubmitOutput | SimpleHookOutput;

const EMPTY_RESULT: SimpleHookOutput = {};

interface UserPromptSubmitInput {
  session_id?: string;
  cwd?: string;
  user_prompt?: string;
  hook_event_name?: string;
}

async function main(): Promise<void> {
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

    const [
      { loadConfig },
      { createEmbedding },
      { globalConceptsCollectionName },
      { createVectorDB },
    ] = await Promise.all([
      import('../config.js'),
      import('../embedding/factory.js'),
      import('../paths.js'),
      import('../vectordb/factory.js'),
    ]);

    const config = loadConfig();
    const conceptsCol = globalConceptsCollectionName();

    const vectordb = await createVectorDB(config, { skipBootstrap: true });

    // Quick-exit if no global concepts collection
    if (!(await vectordb.hasCollection(conceptsCol))) {
      return EMPTY_RESULT;
    }

    const embedding = createEmbedding(config);
    await embedding.initialize();

    const queryVector = await embedding.embed(userPrompt);
    const results = await vectordb.search(conceptsCol, {
      queryVector,
      queryText: userPrompt,
      limit: SEARCH_LIMIT,
    });

    const relevant = results.filter((r) => r.score >= SCORE_THRESHOLD);
    if (relevant.length === 0) {
      return EMPTY_RESULT;
    }

    const lines = relevant.map((r) => `- ${r.content}`);
    const additionalContext = `## Relevant Knowledge\n${lines.join('\n')}`;

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

void main();
