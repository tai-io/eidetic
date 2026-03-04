import os from 'node:os';
import path from 'node:path';
import { z } from 'zod';
import { ConfigError } from './errors.js';

const configSchema = z
  .object({
    embeddingProvider: z.enum(['openai', 'ollama', 'local']).default('openai'),
    openaiApiKey: z.string().default(''),
    openaiBaseUrl: z.string().optional(),
    ollamaBaseUrl: z.string().default('http://localhost:11434/v1'),
    embeddingModel: z.string().optional(),
    embeddingBatchSize: z.coerce.number().int().min(1).max(2048).default(100),
    indexingConcurrency: z.coerce.number().int().min(1).max(32).default(8),
    qdrantUrl: z.string().default('http://localhost:6333'),
    qdrantApiKey: z.string().optional(),
    vectordbProvider: z.enum(['qdrant', 'milvus']).default('qdrant'),
    milvusAddress: z.string().default('localhost:19530'),
    milvusToken: z.string().optional(),
    eideticDataDir: z.string().default(path.join(os.homedir(), '.eidetic')),
    customExtensions: z.preprocess(
      (val) => (typeof val === 'string' ? JSON.parse(val) : val),
      z.array(z.string()).default([]),
    ),
    customIgnorePatterns: z.preprocess(
      (val) => (typeof val === 'string' ? JSON.parse(val) : val),
      z.array(z.string()).default([]),
    ),
    raptorEnabled: z.preprocess(
      (val) => (val === 'false' ? false : val === 'true' ? true : val),
      z.boolean().default(true),
    ),
    raptorTimeoutMs: z.coerce.number().int().min(1000).default(60000),
    raptorLlmModel: z.string().default('gpt-4o-mini'),
  })
  .transform((cfg) => ({
    ...cfg,
    // Default embedding model depends on provider
    embeddingModel:
      cfg.embeddingModel ??
      (cfg.embeddingProvider === 'ollama' ? 'nomic-embed-text' : 'text-embedding-3-small'),
  }));

export type Config = z.infer<typeof configSchema>;

let cachedConfig: Config | null = null;

export function loadConfig(): Config {
  const raw = {
    embeddingProvider: process.env.EMBEDDING_PROVIDER,
    openaiApiKey: (process.env.OPENAI_API_KEY ?? '').trim().replace(/^["']|["']$/g, ''),
    openaiBaseUrl: process.env.OPENAI_BASE_URL?.trim() ?? undefined,
    ollamaBaseUrl: process.env.OLLAMA_BASE_URL,
    embeddingModel: process.env.EMBEDDING_MODEL?.trim() ?? undefined,
    embeddingBatchSize: process.env.EMBEDDING_BATCH_SIZE,
    indexingConcurrency: process.env.INDEXING_CONCURRENCY,
    qdrantUrl: process.env.QDRANT_URL,
    qdrantApiKey: process.env.QDRANT_API_KEY?.trim().replace(/^["']|["']$/g, '') ?? undefined,
    vectordbProvider: process.env.VECTORDB_PROVIDER,
    milvusAddress: process.env.MILVUS_ADDRESS,
    milvusToken: process.env.MILVUS_TOKEN?.trim().replace(/^["']|["']$/g, '') ?? undefined,
    eideticDataDir: process.env.EIDETIC_DATA_DIR,
    customExtensions: process.env.CUSTOM_EXTENSIONS,
    customIgnorePatterns: process.env.CUSTOM_IGNORE_PATTERNS,
    raptorEnabled: process.env.RAPTOR_ENABLED,
    raptorTimeoutMs: process.env.RAPTOR_TIMEOUT_MS,
    raptorLlmModel: process.env.RAPTOR_LLM_MODEL,
  };

  const result = configSchema.safeParse(raw);
  if (!result.success) {
    const issues = result.error.issues.map((i) => `  ${i.path.join('.')}: ${i.message}`).join('\n');
    throw new ConfigError(`Invalid configuration:\n${issues}`);
  }

  const config = result.data;

  cachedConfig = config;
  return cachedConfig;
}

export function getConfig(): Config {
  if (!cachedConfig) {
    return loadConfig();
  }
  return cachedConfig;
}
