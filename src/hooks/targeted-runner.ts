#!/usr/bin/env node
/**
 * Standalone CLI for background targeted re-indexing.
 * Spawned as a detached child process by stop-hook.ts.
 *
 * Usage: node targeted-runner.js <manifest-json-path>
 *
 * Manifest JSON: { projectPath: string, modifiedFiles: string[] }
 */

import fs from 'node:fs';
import { indexFiles } from '../core/targeted-indexer.js';
import { createEmbedding } from '../embedding/factory.js';
import { createVectorDB } from '../vectordb/factory.js';
import { loadConfig } from '../config.js';


async function main(): Promise<void> {
  const manifestPath = process.argv[2];
  if (!manifestPath) {
    process.stderr.write('Usage: targeted-runner.js <manifest-json-path>\n');
    process.exit(1);
  }

  let manifest: { projectPath: string; modifiedFiles: string[] };
  try {
    manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf-8')) as typeof manifest;
  } catch (err) {
    process.stderr.write(`[targeted-runner] Failed to read manifest: ${String(err)}\n`);
    process.exit(1);
  }

  // Clean up manifest file
  try {
    fs.unlinkSync(manifestPath);
  } catch {
    // Ignore — best effort
  }

  const { projectPath, modifiedFiles } = manifest;

  if (!projectPath || !Array.isArray(modifiedFiles) || modifiedFiles.length === 0) {
    process.stderr.write('[targeted-runner] Empty or invalid manifest, nothing to do.\n');
    process.exit(0);
  }

  try {
    const config = loadConfig();
    const embedding = createEmbedding(config);
    await embedding.initialize();

    const vectordb = await createVectorDB(config);

    const result = await indexFiles(projectPath, modifiedFiles, embedding, vectordb);

    process.stderr.write(
      `[targeted-runner] Re-indexed ${result.processedFiles} files ` +
        `(${result.totalChunks} chunks, ${result.skippedFiles} deleted) ` +
        `in ${result.durationMs}ms\n`,
    );

  } catch (err) {
    process.stderr.write(`[targeted-runner] Failed: ${String(err)}\n`);
    process.exit(1);
  }
}

void main();
