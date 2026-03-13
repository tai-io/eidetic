#!/usr/bin/env node
/**
 * Standalone script spawned as a detached child process to extract memories from buffered items.
 *
 * Args: sessionId, project
 *
 * Flow:
 * 1. Check extraction lock — exit if not set (another runner cleared it)
 * 2. Sweep stale items (>24 hours) from any session
 * 3. Flush buffer → extract via LLM → store query-grouped facts → clear buffer
 * 4. Clear extraction lock on completion (or on error, so retries work)
 */

import { MemoryBuffer } from './buffer.js';
import { extractMemories } from './memory-extractor.js';
import { getBufferDbPath } from '../paths.js';

const STALE_ITEM_MAX_AGE_MS = 24 * 60 * 60 * 1000; // 24 hours

async function main(): Promise<void> {
  const sessionId = process.argv[2];
  const project = process.argv[3] ?? 'global';

  if (!sessionId) {
    process.stderr.write('[eidetic] buffer-runner: missing sessionId arg\n');
    process.exit(1);
  }

  const buffer = new MemoryBuffer(getBufferDbPath());

  try {
    // Check lock — if not set, another runner already handled it
    if (!buffer.isConsolidating(sessionId)) {
      return;
    }

    // Sweep stale items from any session first
    const staleItems = buffer.clearStaleItems(STALE_ITEM_MAX_AGE_MS);
    if (staleItems.length > 0) {
      process.stderr.write(
        `[eidetic] buffer-runner: cleared ${staleItems.length} stale buffer items\n`,
      );
    }

    // Flush current session's buffer
    const items = buffer.flush(sessionId);
    if (items.length === 0) {
      buffer.clearConsolidating(sessionId);
      return;
    }

    // Load config for API key
    const { loadConfig } = await import('../config.js');
    const config = loadConfig();

    // Extract query-grouped facts via LLM
    const result = await extractMemories(items, config.openaiApiKey);

    // Store extracted query groups
    if (result.groups.length > 0) {
      const [
        { createEmbedding },
        { MemoryHistory },
        { MemoryStore },
        { MarkdownMemoryDB },
        { getMemoryDbPath, getMemoriesDir, getVectorCachePath },
      ] = await Promise.all([
        import('../embedding/factory.js'),
        import('./history.js'),
        import('./store.js'),
        import('./markdown-memorydb.js'),
        import('../paths.js'),
      ]);

      const embedding = createEmbedding(config);
      await embedding.initialize();

      const memoriesDir = getMemoriesDir(project);
      const memorydb = new MarkdownMemoryDB(memoriesDir, getVectorCachePath(memoriesDir));
      const history = new MemoryHistory(getMemoryDbPath());
      const store = new MemoryStore(embedding, memorydb, history);

      let totalFacts = 0;
      try {
        for (const group of result.groups) {
          const action = await store.addQueryWithFacts(
            group.query,
            group.facts,
            sessionId,
            project,
          );
          totalFacts += action.factsAdded;
        }
      } finally {
        memorydb.close();
        history.close();
      }

      process.stderr.write(
        `[eidetic] buffer-runner: stored ${result.groups.length} query groups (${totalFacts} facts)\n`,
      );
    }

    // Clear buffer after successful extraction
    buffer.clear(sessionId);

    process.stderr.write(
      `[eidetic] buffer-runner: extracted ${items.length} items for session ${sessionId}\n`,
    );
  } catch (err) {
    process.stderr.write(`[eidetic] buffer-runner failed: ${String(err)}\n`);
  } finally {
    buffer.clearConsolidating(sessionId);
  }
}

void main();
