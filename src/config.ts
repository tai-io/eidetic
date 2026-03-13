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
    eideticDataDir: z.string().default(path.join(os.homedir(), '.eidetic')),
    eideticVaultDir: z.string().optional(),
    extractionModel: z.string().default('gpt-4o-mini'),
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
    eideticDataDir: process.env.EIDETIC_DATA_DIR,
    eideticVaultDir: process.env.EIDETIC_VAULT_DIR?.trim() ?? undefined,
    extractionModel: process.env.EXTRACTION_MODEL?.trim() ?? undefined,
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
