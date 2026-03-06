#!/usr/bin/env node
/**
 * Standalone script spawned as a detached child process to consolidate buffered facts.
 *
 * Args: sessionId, project
 *
 * Flow:
 * 1. Check consolidation lock — exit if not set (another runner cleared it)
 * 2. Flush buffer → consolidate via LLM → store memories → add graph triples → clear buffer
 * 3. Clear consolidation lock on completion (or on error, so retries work)
 * 4. Also sweep stale items (>6 hours) from any session
 */

import { MemoryBuffer } from './buffer.js';
import { MemoryGraph } from './graph.js';
import { consolidateBuffer } from './buffer-consolidator.js';
import { getBufferDbPath } from '../paths.js';

const STALE_ITEM_MAX_AGE_MS = 6 * 60 * 60 * 1000; // 6 hours

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

    // Consolidate via LLM
    const result = await consolidateBuffer(items, config.openaiApiKey);

    // Store consolidated memories if any
    if (result.memories.length > 0) {
      const [{ createEmbedding }, { MemoryHistory }, { MemoryStore }, { getMemoryDbPath }] =
        await Promise.all([
          import('../embedding/factory.js'),
          import('./history.js'),
          import('./store.js'),
          import('../paths.js'),
        ]);

      const embedding = createEmbedding(config);
      await embedding.initialize();

      const { createVectorDB } = await import('../vectordb/factory.js');
      const vectordb = await createVectorDB(config, { skipBootstrap: true });

      const history = new MemoryHistory(getMemoryDbPath());
      const store = new MemoryStore(embedding, vectordb, history);

      await store.addMemory(result.memories, 'buffer-consolidation', project);

      process.stderr.write(
        `[eidetic] buffer-runner: stored ${result.memories.length} consolidated memories\n`,
      );
    }

    // Store graph triples if any
    if (result.graph.length > 0) {
      const graph = new MemoryGraph(getBufferDbPath());
      graph.addTriples(result.graph, project);
      graph.persist();

      process.stderr.write(
        `[eidetic] buffer-runner: stored ${result.graph.length} graph triples\n`,
      );
    }

    // Clear buffer after successful consolidation
    buffer.clear(sessionId);

    process.stderr.write(
      `[eidetic] buffer-runner: consolidated ${items.length} items for session ${sessionId}\n`,
    );
  } catch (err) {
    process.stderr.write(`[eidetic] buffer-runner failed: ${String(err)}\n`);
  } finally {
    buffer.clearConsolidating(sessionId);
  }
}

void main();
