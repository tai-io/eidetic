import { describe, it, expect, vi, beforeEach } from 'vitest';

// Must re-import loadConfig each test to avoid cached config
describe('loadConfig', () => {
  beforeEach(() => {
    vi.unstubAllEnvs();
    // Reset module cache so cachedConfig is cleared
    vi.resetModules();
  });

  async function freshLoadConfig() {
    const mod = await import('../config.js');
    return mod.loadConfig;
  }

  it('loads with valid OPENAI_API_KEY', async () => {
    vi.stubEnv('OPENAI_API_KEY', 'sk-test-key');
    const loadConfig = await freshLoadConfig();
    const config = loadConfig();
    expect(config.openaiApiKey).toBe('sk-test-key');
    expect(config.embeddingProvider).toBe('openai');
  });

  it('uses default values', async () => {
    vi.stubEnv('OPENAI_API_KEY', 'sk-test-key');
    const loadConfig = await freshLoadConfig();
    const config = loadConfig();
    expect(config.embeddingBatchSize).toBe(100);
    expect(config.embeddingModel).toBe('text-embedding-3-small');
  });

  it('allows missing API key for openai provider (guard moved to server startup)', async () => {
    vi.stubEnv('OPENAI_API_KEY', '');
    const loadConfig = await freshLoadConfig();
    const config = loadConfig();
    expect(config.embeddingProvider).toBe('openai');
    expect(config.openaiApiKey).toBe('');
  });

  it('allows missing API key for ollama provider', async () => {
    vi.stubEnv('OPENAI_API_KEY', '');
    vi.stubEnv('EMBEDDING_PROVIDER', 'ollama');
    const loadConfig = await freshLoadConfig();
    const config = loadConfig();
    expect(config.embeddingProvider).toBe('ollama');
    expect(config.embeddingModel).toBe('nomic-embed-text');
  });

  it('strips surrounding quotes from API key', async () => {
    vi.stubEnv('OPENAI_API_KEY', '"sk-test-key"');
    const loadConfig = await freshLoadConfig();
    const config = loadConfig();
    expect(config.openaiApiKey).toBe('sk-test-key');
  });

  it('strips single quotes from API key', async () => {
    vi.stubEnv('OPENAI_API_KEY', "'sk-test-key'");
    const loadConfig = await freshLoadConfig();
    const config = loadConfig();
    expect(config.openaiApiKey).toBe('sk-test-key');
  });

  it('parses batch size from env', async () => {
    vi.stubEnv('OPENAI_API_KEY', 'sk-test');
    vi.stubEnv('EMBEDDING_BATCH_SIZE', '50');
    const loadConfig = await freshLoadConfig();
    const config = loadConfig();
    expect(config.embeddingBatchSize).toBe(50);
  });

  it('defaults extractionModel to gpt-4o-mini', async () => {
    vi.stubEnv('OPENAI_API_KEY', 'sk-test');
    const loadConfig = await freshLoadConfig();
    const config = loadConfig();
    expect(config.extractionModel).toBe('gpt-4o-mini');
  });

  it('overrides extractionModel from EXTRACTION_MODEL env var', async () => {
    vi.stubEnv('OPENAI_API_KEY', 'sk-test');
    vi.stubEnv('EXTRACTION_MODEL', 'gpt-4.1-nano');
    const loadConfig = await freshLoadConfig();
    const config = loadConfig();
    expect(config.extractionModel).toBe('gpt-4.1-nano');
  });
});
