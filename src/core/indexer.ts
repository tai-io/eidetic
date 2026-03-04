import fs from 'node:fs';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import type { Embedding } from '../embedding/types.js';
import type { VectorDB, CodeDocument } from '../vectordb/types.js';
import type { CodeChunk } from '../splitter/types.js';
import { AstSplitter } from '../splitter/ast.js';
import { LineSplitter } from '../splitter/line.js';
import { scanFiles, buildSnapshot, diffSnapshots, extensionToLanguage } from './sync.js';
import { getConfig } from '../config.js';
import { normalizePath, pathToCollectionName } from '../paths.js';
import { IndexingError } from '../errors.js';
import { classifyFileCategory } from './file-category.js';
import { loadSnapshot, saveSnapshot } from './snapshot-io.js';

export { previewCodebase, type PreviewResult } from './preview.js';
export { saveSnapshot, deleteSnapshot, snapshotExists } from './snapshot-io.js';

export interface IndexResult {
  totalFiles: number;
  totalChunks: number;
  addedFiles: number;
  modifiedFiles: number;
  removedFiles: number;
  skippedFiles: number;
  estimatedTokens: number;
  estimatedCostUsd: number;
  durationMs: number;
  parseFailures: string[];
}

export async function indexCodebase(
  rootPath: string,
  embedding: Embedding,
  vectordb: VectorDB,
  force = false,
  onProgress?: (pct: number, msg: string) => void,
  customExtensions?: string[],
  customIgnorePatterns?: string[],
): Promise<IndexResult> {
  const start = Date.now();
  const normalizedPath = normalizePath(rootPath);
  const collectionName = pathToCollectionName(normalizedPath);
  const config = getConfig();

  onProgress?.(0, 'Scanning files...');
  const filePaths = await scanFiles(normalizedPath, customExtensions, customIgnorePatterns);

  if (filePaths.length === 0) {
    throw new IndexingError(`No indexable files found in ${normalizedPath}`);
  }

  const currentSnapshot = buildSnapshot(normalizedPath, filePaths);

  let filesToProcess: string[];
  let removedFiles: string[] = [];
  let addedCount = 0;
  let modifiedCount = 0;

  if (force) {
    onProgress?.(5, 'Dropping existing index...');
    await vectordb.dropCollection(collectionName);
    await vectordb.createCollection(collectionName, embedding.dimension);
    filesToProcess = filePaths;
    addedCount = filePaths.length;
  } else {
    const previousSnapshot = loadSnapshot(normalizedPath);

    if (!previousSnapshot || !(await vectordb.hasCollection(collectionName))) {
      // First time indexing
      await vectordb.createCollection(collectionName, embedding.dimension);
      filesToProcess = filePaths;
      addedCount = filePaths.length;
    } else {
      const diff = diffSnapshots(previousSnapshot, currentSnapshot);
      addedCount = diff.added.length;
      modifiedCount = diff.modified.length;
      removedFiles = diff.removed;

      const toDelete = [...diff.removed, ...diff.modified];
      for (const rel of toDelete) {
        await vectordb.deleteByPath(collectionName, rel);
      }

      filesToProcess = [...diff.added, ...diff.modified];
    }
  }

  if (filesToProcess.length === 0) {
    saveSnapshot(normalizedPath, currentSnapshot);
    return {
      totalFiles: filePaths.length,
      totalChunks: 0,
      addedFiles: 0,
      modifiedFiles: 0,
      removedFiles: removedFiles.length,
      skippedFiles: filePaths.length,
      estimatedTokens: 0,
      estimatedCostUsd: 0,
      durationMs: Date.now() - start,
      parseFailures: [],
    };
  }

  onProgress?.(10, `Splitting ${filesToProcess.length} files...`);
  const astSplitter = new AstSplitter();
  const lineSplitter = new LineSplitter();
  const allChunks: CodeChunk[] = [];
  const parseFailures: string[] = [];

  const concurrency = config.indexingConcurrency;
  for (let i = 0; i < filesToProcess.length; i += concurrency) {
    const batch = filesToProcess.slice(i, i + concurrency);
    const batchResults = await Promise.all(
      // eslint-disable-next-line @typescript-eslint/require-await
      batch.map(async (relPath): Promise<{ chunks: CodeChunk[]; failed: boolean }> => {
        const fullPath = path.join(normalizedPath, relPath);
        try {
          const code = fs.readFileSync(fullPath, 'utf-8');
          if (code.trim().length === 0) return { chunks: [], failed: false };

          const ext = path.extname(relPath);
          const language = extensionToLanguage(ext);

          let chunks = astSplitter.split(code, language, relPath);
          if (chunks.length === 0) {
            chunks = lineSplitter.split(code, language, relPath);
          }
          if (chunks.length === 0) return { chunks: [], failed: true };
          return { chunks, failed: false };
        } catch (err) {
          console.warn(`Failed to process "${relPath}":`, err);
          return { chunks: [], failed: true };
        }
      }),
    );
    for (let j = 0; j < batchResults.length; j++) {
      const { chunks, failed } = batchResults[j];
      allChunks.push(...chunks);
      if (failed) parseFailures.push(batch[j]);
    }
  }

  if (parseFailures.length > 0) {
    console.warn(
      `Warning: ${parseFailures.length} file(s) produced no chunks: ${parseFailures.slice(0, 10).join(', ')}` +
        (parseFailures.length > 10 ? ` (and ${parseFailures.length - 10} more)` : ''),
    );
  }

  if (allChunks.length === 0) {
    saveSnapshot(normalizedPath, currentSnapshot);
    return {
      totalFiles: filePaths.length,
      totalChunks: 0,
      addedFiles: addedCount,
      modifiedFiles: modifiedCount,
      removedFiles: removedFiles.length,
      skippedFiles: filePaths.length - filesToProcess.length,
      estimatedTokens: 0,
      estimatedCostUsd: 0,
      durationMs: Date.now() - start,
      parseFailures,
    };
  }

  const chunkTexts = allChunks.map((c) => c.content);
  const estimation = embedding.estimateTokens(chunkTexts);
  console.log(
    `Indexing ${filesToProcess.length} files -> ${allChunks.length} chunks -> ` +
      `~${(estimation.estimatedTokens / 1000).toFixed(0)}K tokens (~$${estimation.estimatedCostUsd.toFixed(4)})`,
  );

  const batchSize = config.embeddingBatchSize;
  let processedChunks = 0;

  for (let i = 0; i < allChunks.length; i += batchSize) {
    const batch = allChunks.slice(i, i + batchSize);
    const texts = batch.map((c) => c.content);

    const pct = 10 + Math.round((i / allChunks.length) * 85);
    onProgress?.(
      pct,
      `Embedding batch ${Math.floor(i / batchSize) + 1}/${Math.ceil(allChunks.length / batchSize)}...`,
    );

    const vectors = await embedding.embedBatch(texts);
    if (vectors.length !== texts.length) {
      throw new IndexingError(
        `Embedding dimension mismatch: sent ${texts.length} texts, got ${vectors.length} vectors`,
      );
    }

    const documents: CodeDocument[] = batch.map((chunk, j) => ({
      id: randomUUID(),
      content: chunk.content,
      vector: vectors[j],
      relativePath: chunk.filePath,
      startLine: chunk.startLine,
      endLine: chunk.endLine,
      fileExtension: path.extname(chunk.filePath),
      language: chunk.language,
      fileCategory: classifyFileCategory(chunk.filePath),
      symbolName: chunk.symbolName,
      symbolKind: chunk.symbolKind,
      symbolSignature: chunk.symbolSignature,
      parentSymbol: chunk.parentSymbol,
    }));

    await vectordb.insert(collectionName, documents);
    processedChunks += batch.length;
  }

  onProgress?.(95, 'Saving snapshot...');
  saveSnapshot(normalizedPath, currentSnapshot);

  // Run RAPTOR knowledge generation (non-fatal)
  if (config.raptorEnabled) {
    try {
      onProgress?.(97, 'Generating knowledge summaries...');
      const projectName = path.basename(normalizedPath);
      const { runRaptor } = await import('./raptor.js');
      await runRaptor(projectName, collectionName, embedding, vectordb);
    } catch (err) {
      console.warn(`RAPTOR knowledge generation failed (non-fatal): ${String(err)}`);
    }
  }

  onProgress?.(100, 'Done');

  return {
    totalFiles: filePaths.length,
    totalChunks: processedChunks,
    addedFiles: addedCount,
    modifiedFiles: modifiedCount,
    removedFiles: removedFiles.length,
    skippedFiles: filePaths.length - filesToProcess.length,
    estimatedTokens: estimation.estimatedTokens,
    estimatedCostUsd: estimation.estimatedCostUsd,
    durationMs: Date.now() - start,
    parseFailures,
  };
}
