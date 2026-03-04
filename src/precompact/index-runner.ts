#!/usr/bin/env node
/**
 * Standalone CLI for background indexing of session notes.
 * Called by session-indexer.ts as a detached child process.
 *
 * Usage: node index-runner.js <notes-directory>
 */

import { indexCodebase } from '../core/indexer.js';
import { createEmbedding } from '../embedding/factory.js';
import { QdrantVectorDB } from '../vectordb/qdrant.js';
import { bootstrapQdrant } from '../infra/qdrant-bootstrap.js';
import { loadConfig } from '../config.js';
import { registerProject } from '../state/registry.js';
import type { VectorDB } from '../vectordb/types.js';

async function main(): Promise<void> {
  const notesDir = process.argv[2];
  if (!notesDir) {
    process.stderr.write('Usage: index-runner.js <notes-directory>\n');
    process.exit(1);
  }

  try {
    // Load config (requires OPENAI_API_KEY in env)
    const config = loadConfig();

    // Create embedding provider
    const embedding = createEmbedding(config);
    await embedding.initialize();

    // Create vectordb using factory pattern (respects VECTORDB_PROVIDER)
    let vectordb: VectorDB;
    if (config.vectordbProvider === 'milvus') {
      const { MilvusVectorDB } = await import('../vectordb/milvus.js');
      vectordb = new MilvusVectorDB();
    } else {
      const { url: qdrantUrl } = await bootstrapQdrant();
      vectordb = new QdrantVectorDB(qdrantUrl, config.qdrantApiKey);
    }

    // Index the notes directory
    const result = await indexCodebase(
      notesDir,
      embedding,
      vectordb,
      false, // don't force re-index
      undefined, // no progress callback
      ['.md'], // only markdown files
      [], // no extra ignore patterns
    );

    // Register project in registry for discovery
    registerProject(notesDir);

    process.stderr.write(
      `Indexed ${result.totalFiles} files (${result.totalChunks} chunks) in ${result.durationMs}ms\n`,
    );
  } catch (err) {
    // Best effort - log error but don't crash loudly
    process.stderr.write(`Background indexing failed: ${String(err)}\n`);
    process.exit(1);
  }
}

void main();
