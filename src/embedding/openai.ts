import { createHash } from 'node:crypto';
import fsp from 'node:fs/promises';
import path from 'node:path';
import OpenAI from 'openai';
import { type Embedding, type EmbeddingVector, type TokenEstimate } from './types.js';
import { EmbeddingError } from '../errors.js';
import { getConfig } from '../config.js';
import { getCacheDir } from '../paths.js';
import { truncateToSafeLength } from './truncate.js';

const RETRY_DELAYS = [1000, 4000, 16000]; // exponential backoff
const RETRYABLE_STATUS = new Set([429, 500, 502, 503]);
const MAX_MEMORY_CACHE_SIZE = 10_000;
const MAX_RETRY_AFTER_MS = 60_000;

export function contentHash(text: string): string {
  return createHash('sha256').update(text).digest('hex').slice(0, 16);
}

export interface OpenAIEmbeddingOptions {
  apiKey?: string;
  baseUrl?: string;
  model?: string;
}

export class OpenAIEmbedding implements Embedding {
  private client: OpenAI;
  private model: string;
  private _dimension = 0;
  private initialized = false;
  private memoryCache = new Map<string, EmbeddingVector>();
  private cacheDir: string;

  constructor(options?: OpenAIEmbeddingOptions) {
    const config = getConfig();
    const apiKey = options?.apiKey ?? config.openaiApiKey;
    const baseUrl = options?.baseUrl ?? config.openaiBaseUrl;
    this.client = new OpenAI({
      apiKey,
      ...(baseUrl && { baseURL: baseUrl }),
    });
    this.model = options?.model ?? config.embeddingModel;
    this.cacheDir = path.join(getCacheDir(), 'embeddings');
  }

  get dimension(): number {
    return this._dimension;
  }

  /**
   * Validate the API key and detect embedding dimension by embedding a test string.
   * Must be called once before any other operations.
   */
  async initialize(): Promise<void> {
    try {
      const result = await this.callApi(['dimension probe']);
      this._dimension = result[0].length;
      this.initialized = true;
      console.log(`Embedding model "${this.model}" validated. Dimension: ${this._dimension}`);
    } catch (err) {
      throw new EmbeddingError(
        `Failed to initialize embedding provider. Check your API key, base URL, and model name. ` +
          `Model: "${this.model}"`,
        err,
      );
    }
  }

  private ensureInitialized(): void {
    if (!this.initialized) {
      throw new EmbeddingError(
        'Embedding provider not initialized. Call initialize() before embed/embedBatch.',
      );
    }
  }

  async embed(text: string): Promise<EmbeddingVector> {
    this.ensureInitialized();
    const results = await this.embedBatch([text]);
    return results[0];
  }

  async embedBatch(texts: string[]): Promise<EmbeddingVector[]> {
    this.ensureInitialized();
    if (texts.length === 0) return [];

    // Track which indices have empty/whitespace-only text so we return zero vectors for them
    const emptyIndices = new Set<number>();
    for (let i = 0; i < texts.length; i++) {
      if (texts[i].trim().length === 0) {
        emptyIndices.add(i);
      }
    }

    const results: (EmbeddingVector | null)[] = Array.from<EmbeddingVector | null>({
      length: texts.length,
    }).fill(null);

    // Fill empty-text slots with zero vectors immediately
    for (const i of emptyIndices) {
      results[i] = new Array<number>(this._dimension).fill(0);
    }

    // Check caches for non-empty texts
    for (let i = 0; i < texts.length; i++) {
      if (emptyIndices.has(i)) continue;
      const hash = contentHash(texts[i]);
      const memHit = this.memoryCache.get(hash);
      if (memHit) {
        results[i] = memHit;
        continue;
      }
      const diskHit = await this.readDiskCache(hash);
      if (diskHit) {
        this.setMemoryCache(hash, diskHit);
        results[i] = diskHit;
      }
    }

    const uncachedIndices: number[] = [];
    const uncachedTexts: string[] = [];
    for (let i = 0; i < texts.length; i++) {
      if (results[i] === null) {
        uncachedIndices.push(i);
        uncachedTexts.push(texts[i]);
      }
    }

    if (uncachedTexts.length === 0) {
      return results as EmbeddingVector[];
    }

    const batchSize = getConfig().embeddingBatchSize;
    const freshEmbeddings: EmbeddingVector[] = [];

    for (let offset = 0; offset < uncachedTexts.length; offset += batchSize) {
      const batch = uncachedTexts.slice(offset, offset + batchSize);
      const batchResult = await this.callWithRetry(batch);
      freshEmbeddings.push(...batchResult);
    }

    for (let i = 0; i < uncachedIndices.length; i++) {
      const idx = uncachedIndices[i];
      const hash = contentHash(texts[idx]);
      const vec = freshEmbeddings[i];
      this.setMemoryCache(hash, vec);
      this.writeDiskCache(hash, vec);
      results[idx] = vec;
    }

    if (results.some((r) => r === null)) {
      throw new EmbeddingError(
        'Missing embeddings: some texts did not receive vectors after cache lookup and API call.',
      );
    }

    return results as EmbeddingVector[];
  }

  estimateTokens(texts: string[]): TokenEstimate {
    const totalChars = texts.reduce((sum, t) => sum + t.length, 0);
    const estimatedTokens = Math.ceil(totalChars / 4);

    // Per-million-token pricing for known OpenAI models; local models are free
    const COST_PER_MILLION: Record<string, number> = {
      'text-embedding-3-small': 0.02,
      'text-embedding-3-large': 0.13,
      'text-embedding-ada-002': 0.1,
    };
    const rate = COST_PER_MILLION[this.model] ?? 0;
    const estimatedCostUsd = (estimatedTokens / 1_000_000) * rate;

    return { totalChars, estimatedTokens, estimatedCostUsd };
  }

  private setMemoryCache(hash: string, vec: EmbeddingVector): void {
    if (this.memoryCache.size >= MAX_MEMORY_CACHE_SIZE && !this.memoryCache.has(hash)) {
      // Delete the oldest entry (first key from the iterator)
      const oldest = this.memoryCache.keys().next().value;
      if (oldest !== undefined) {
        this.memoryCache.delete(oldest);
      }
    }
    this.memoryCache.set(hash, vec);
  }

  private async callWithRetry(texts: string[]): Promise<EmbeddingVector[]> {
    let currentBatchSize = texts.length;
    const allResults: EmbeddingVector[] = [];
    let startOffset = 0;

    for (let attempt = 0; attempt < RETRY_DELAYS.length + 1; attempt++) {
      try {
        for (let offset = startOffset; offset < texts.length; offset += currentBatchSize) {
          const batch = texts.slice(offset, offset + currentBatchSize);
          const result = await this.callApi(batch);
          allResults.push(...result);
          startOffset = offset + currentBatchSize;
        }
        return allResults;
      } catch (err) {
        const status = (err as { status?: number }).status;
        const isRetryable = status !== undefined && RETRYABLE_STATUS.has(status);

        if (!isRetryable || attempt >= RETRY_DELAYS.length) {
          throw new EmbeddingError(
            `Embedding API call failed after ${attempt + 1} attempt(s). Status: ${status ?? 'unknown'}`,
            err,
          );
        }

        let delay = RETRY_DELAYS[attempt];

        if (status === 429) {
          const retryAfter = (err as { headers?: { 'retry-after'?: string } }).headers?.[
            'retry-after'
          ];
          if (retryAfter) {
            const parsed = parseInt(retryAfter, 10);
            if (!isNaN(parsed)) delay = Math.min(parsed * 1000, MAX_RETRY_AFTER_MS);
          }
          // Halve batch size on rate limit to avoid repeated throttling
          currentBatchSize = Math.max(1, Math.floor(currentBatchSize / 2));
          console.warn(`Rate limited. Retrying in ${delay}ms with batch size ${currentBatchSize}.`);
        } else {
          console.warn(`Embedding API error (status ${status}). Retrying in ${delay}ms...`);
        }

        await sleep(delay);
      }
    }

    throw new EmbeddingError('Unexpected: exhausted retries');
  }

  private async callApi(texts: string[]): Promise<EmbeddingVector[]> {
    const response = await this.client.embeddings.create({
      model: this.model,
      input: texts.map(truncateToSafeLength),
    });

    const sorted = response.data.sort((a, b) => a.index - b.index);
    return sorted.map((d) => d.embedding);
  }

  private getDiskCachePath(hash: string): string {
    // Shard into subdirectories to avoid too many files in one dir
    const shard = hash.slice(0, 2);
    return path.join(
      this.cacheDir,
      this.model.replace(/[^a-zA-Z0-9-]/g, '_'),
      shard,
      `${hash}.json`,
    );
  }

  private async readDiskCache(hash: string): Promise<EmbeddingVector | null> {
    const filepath = this.getDiskCachePath(hash);
    try {
      const data = await fsp.readFile(filepath, 'utf-8');
      return JSON.parse(data) as EmbeddingVector;
    } catch (err) {
      const code = (err as NodeJS.ErrnoException).code;
      if (code === 'ENOENT') {
        // File doesn't exist -- normal cache miss
        return null;
      }
      // Parse error or other I/O problem: warn and remove corrupted file
      console.warn(`Corrupted embedding cache file ${filepath}, deleting.`);
      fsp.unlink(filepath).catch(() => {});
      return null;
    }
  }

  private writeDiskCache(hash: string, vector: EmbeddingVector): void {
    const filepath = this.getDiskCachePath(hash);
    // Fire-and-forget async write
    fsp
      .mkdir(path.dirname(filepath), { recursive: true })
      .then(() => fsp.writeFile(filepath, JSON.stringify(vector)))
      .catch(() => {});
  }
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
