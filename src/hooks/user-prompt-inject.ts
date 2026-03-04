#!/usr/bin/env node
/**
 * UserPromptSubmit hook: inject relevant global concepts into the conversation.
 *
 * Reads stdin JSON (user prompt + cwd), embeds the prompt, searches global concepts,
 * and outputs matching knowledge as additionalContext.
 */

import { execSync } from 'node:child_process';
import path from 'node:path';

const TIMEOUT_MS = 3000;
const SEARCH_LIMIT = 5;
const SCORE_THRESHOLD = 0.3;

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

async function timeout(ms: number): Promise<Record<string, unknown>> {
  return new Promise((resolve) => setTimeout(() => resolve({ hookSpecificOutput: {} }), ms));
}

async function doWork(): Promise<Record<string, unknown>> {
  let input: UserPromptSubmitInput;
  try {
    const raw = await readStdin();
    input = JSON.parse(raw) as UserPromptSubmitInput;
  } catch {
    return { hookSpecificOutput: {} };
  }

  if (input.hook_event_name !== 'UserPromptSubmit') {
    return { hookSpecificOutput: {} };
  }

  const userPrompt = input.user_prompt ?? '';
  if (!userPrompt.trim()) {
    return { hookSpecificOutput: {} };
  }

  try {
    const cwd = input.cwd;
    if (!cwd) {
      return { hookSpecificOutput: {} };
    }
    const projectPath = detectProjectRoot(cwd);
    if (!projectPath) {
      return { hookSpecificOutput: {} };
    }

    const [{ loadConfig }, { createEmbedding }, { globalConceptsCollectionName }] =
      await Promise.all([
        import('../config.js'),
        import('../embedding/factory.js'),
        import('../paths.js'),
      ]);

    const config = loadConfig();
    const conceptsCol = globalConceptsCollectionName();

    // Connect to vectordb without bootstrapping
    let vectordb;
    if (config.vectordbProvider === 'milvus') {
      const { MilvusVectorDB } = await import('../vectordb/milvus.js');
      vectordb = new MilvusVectorDB();
    } else {
      const { QdrantVectorDB } = await import('../vectordb/qdrant.js');
      vectordb = new QdrantVectorDB(config.qdrantUrl, config.qdrantApiKey);
    }

    // Quick-exit if no global concepts collection
    if (!(await vectordb.hasCollection(conceptsCol))) {
      return { hookSpecificOutput: {} };
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
      return { hookSpecificOutput: {} };
    }

    const lines = relevant.map((r) => `- ${r.content}`);
    const additionalContext = `## Relevant Knowledge\n${lines.join('\n')}`;

    return {
      hookSpecificOutput: {
        additionalContext,
        hookEventName: 'UserPromptSubmit',
      },
    };
  } catch (err) {
    process.stderr.write(`user-prompt-inject failed: ${String(err)}\n`);
    return { hookSpecificOutput: {} };
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
