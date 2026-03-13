import { describe, it, expect } from 'vitest';
import { createEmbedding } from '../factory.js';
import { OpenAIEmbedding } from '../openai.js';
import type { Config } from '../../config.js';

function makeConfig(overrides: Partial<Config> = {}): Config {
  return {
    embeddingProvider: 'openai',
    openaiApiKey: 'sk-test',
    openaiBaseUrl: undefined,
    ollamaBaseUrl: 'http://localhost:11434/v1',
    embeddingModel: 'text-embedding-3-small',
    embeddingBatchSize: 100,
    eideticDataDir: '/tmp/eidetic-test',
    extractionModel: 'gpt-4o-mini',
    ...overrides,
  };
}

describe('createEmbedding', () => {
  it('returns OpenAIEmbedding for openai provider', () => {
    const embedding = createEmbedding(makeConfig({ embeddingProvider: 'openai' }));
    expect(embedding).toBeInstanceOf(OpenAIEmbedding);
  });

  it('returns OpenAIEmbedding for ollama provider (OpenAI-compatible)', () => {
    const embedding = createEmbedding(makeConfig({ embeddingProvider: 'ollama' }));
    expect(embedding).toBeInstanceOf(OpenAIEmbedding);
  });

  it('returns OpenAIEmbedding for local provider', () => {
    const embedding = createEmbedding(makeConfig({ embeddingProvider: 'local' }));
    expect(embedding).toBeInstanceOf(OpenAIEmbedding);
  });
});
