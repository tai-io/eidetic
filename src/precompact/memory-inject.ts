#!/usr/bin/env node
/**
 * Inject stored memories at SessionStart.
 * Called by session-start hook to surface previously learned knowledge.
 *
 * Outputs markdown to stdout for hook to capture and inject into session.
 */

import { execSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import type { MemoryItem } from '../memory/types.js';

export async function run(): Promise<void> {
  try {
    // Get cwd from environment (set by Claude Code) or detect from git
    const cwd = process.env.CLAUDE_CWD ?? process.cwd();

    // Detect project root from git
    const projectPath = detectProjectRoot(cwd);
    if (!projectPath) {
      return;
    }

    const projectName = path.basename(projectPath);

    const [{ loadConfig }, { createEmbedding }, { MemoryHistory }, { MemoryStore }, { QueryMemoryDB }, { getMemoryDbPath, getMemoryStorePath }] =
      await Promise.all([
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

    const memories = await store.searchMemory(
      `${projectName} development knowledge`,
      7,
      undefined,
      projectName,
    );
    if (memories.length === 0) {
      return;
    }

    process.stdout.write(formatMemoryContext(memories));
  } catch (err) {
    process.stderr.write(`Memory inject failed: ${String(err)}\n`);
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

export function formatMemoryContext(memories: MemoryItem[]): string {
  const lines: string[] = [];

  lines.push('## Remembered Knowledge');

  for (const m of memories) {
    const kindLabel = `[${m.kind}] `;
    lines.push(`- ${kindLabel}${m.memory}`);
  }

  lines.push('');
  lines.push('_search_memory(query) for more. add_memory(query, facts) to save new findings._');
  lines.push('');

  return lines.join('\n');
}

// CLI router calls run() directly; self-execute when run as standalone script
if (process.argv[1] === fileURLToPath(import.meta.url)) {
  void run();
}
