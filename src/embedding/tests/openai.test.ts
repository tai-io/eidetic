import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { contentHash, OpenAIEmbedding } from '../openai.js';
import { EmbeddingError } from '../../errors.js';

// ── Mocks ────────────────────────────────────────────────────────────────────

vi.mock('../../config.js', () => ({
  getConfig: () => ({
    openaiApiKey: 'test-key',
    openaiBaseUrl: undefined,
    embeddingModel: 'text-embedding-3-small',
    embeddingBatchSize: 3,
  }),
}));

vi.mock('../../paths.js', () => ({
  getCacheDir: () => '/tmp/eidetic-test-cache',
}));

const mockReadFile = vi.fn();
const mockWriteFile = vi.fn();
const mockMkdir = vi.fn();
const mockUnlink = vi.fn();

vi.mock('node:fs/promises', () => ({
  default: {
    readFile: (...args: unknown[]) => mockReadFile(...args),
    writeFile: (...args: unknown[]) => mockWriteFile(...args),
    mkdir: (...args: unknown[]) => mockMkdir(...args),
    unlink: (...args: unknown[]) => mockUnlink(...args),
  },
}));

const mockCreate = vi.fn();

vi.mock('openai', () => {
  return {
    default: class MockOpenAI {
      embeddings = { create: mockCreate };
    },
  };
});

// ── Helpers ──────────────────────────────────────────────────────────────────

function fakeEmbeddingResponse(vectors: number[][]) {
  return {
    data: vectors.map((embedding, index) => ({ embedding, index })),
  };
}

async function createInitialized(dimension = 4): Promise<OpenAIEmbedding> {
  const probeVector = Array.from({ length: dimension }, (_, i) => i * 0.1);
  mockCreate.mockResolvedValueOnce(fakeEmbeddingResponse([probeVector]));
  const emb = new OpenAIEmbedding();
  await emb.initialize();
  return emb;
}

// ── Tests ────────────────────────────────────────────────────────────────────

describe('contentHash', () => {
  it('returns a 16-hex-char string', () => {
    const hash = contentHash('hello world');
    expect(hash).toMatch(/^[a-f0-9]{16}$/);
  });

  it('is deterministic', () => {
    expect(contentHash('test')).toBe(contentHash('test'));
  });

  it('produces different hashes for different inputs', () => {
    expect(contentHash('hello')).not.toBe(contentHash('world'));
  });
});

describe('OpenAIEmbedding — retry logic', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockReadFile.mockRejectedValue(Object.assign(new Error('ENOENT'), { code: 'ENOENT' }));
    mockMkdir.mockResolvedValue(undefined);
    mockWriteFile.mockResolvedValue(undefined);
    mockUnlink.mockResolvedValue(undefined);
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('retries on 429 and succeeds', async () => {
    vi.useFakeTimers();
    const emb = await createInitialized(4);

    const rateLimitErr = Object.assign(new Error('Rate limited'), {
      status: 429,
      headers: {},
    });
    const vec = [1, 2, 3, 4];

    mockCreate
      .mockRejectedValueOnce(rateLimitErr)
      .mockResolvedValueOnce(fakeEmbeddingResponse([vec]));

    const promise = emb.embedBatch(['hello']);

    // Advance past the first retry delay (1000ms)
    await vi.advanceTimersByTimeAsync(1100);

    const result = await promise;
    expect(result).toEqual([vec]);
    // initialize + failed attempt + successful retry = 3
    expect(mockCreate).toHaveBeenCalledTimes(3);

    vi.useRealTimers();
  });

  it('retries on 500 server error', async () => {
    vi.useFakeTimers();
    const emb = await createInitialized(4);

    const serverErr = Object.assign(new Error('Internal Server Error'), { status: 500 });
    const vec = [1, 2, 3, 4];

    mockCreate
      .mockRejectedValueOnce(serverErr)
      .mockResolvedValueOnce(fakeEmbeddingResponse([vec]));

    const promise = emb.embedBatch(['hello']);
    await vi.advanceTimersByTimeAsync(1100);

    const result = await promise;
    expect(result).toEqual([vec]);

    vi.useRealTimers();
  });

  it('does not retry on non-retryable error (e.g. 401)', async () => {
    const emb = await createInitialized(4);

    const authErr = Object.assign(new Error('Unauthorized'), { status: 401 });
    mockCreate.mockRejectedValueOnce(authErr);

    await expect(emb.embedBatch(['hello'])).rejects.toThrow(/1 attempt/);
  });

  it('throws after exhausting all retries', async () => {
    vi.useFakeTimers();
    const emb = await createInitialized(4);

    const serverErr = Object.assign(new Error('Server Error'), { status: 500 });
    // Fail 4 times (1 initial + 3 retries)
    mockCreate
      .mockRejectedValueOnce(serverErr)
      .mockRejectedValueOnce(serverErr)
      .mockRejectedValueOnce(serverErr)
      .mockRejectedValueOnce(serverErr);

    // Attach rejection handler immediately to avoid unhandled rejection
    const promise = emb.embedBatch(['hello']).catch((e: unknown) => e);

    // Advance through all retry delays: 1000 + 4000 + 16000
    await vi.advanceTimersByTimeAsync(1100);
    await vi.advanceTimersByTimeAsync(4100);
    await vi.advanceTimersByTimeAsync(16100);

    const err = await promise;
    expect(err).toBeInstanceOf(EmbeddingError);
    expect((err as Error).message).toMatch(/4 attempt/);

    vi.useRealTimers();
  });

  it('respects retry-after header on 429', async () => {
    vi.useFakeTimers();
    const emb = await createInitialized(4);

    const rateLimitErr = Object.assign(new Error('Rate limited'), {
      status: 429,
      headers: { 'retry-after': '2' },
    });
    const vec = [1, 2, 3, 4];

    mockCreate
      .mockRejectedValueOnce(rateLimitErr)
      .mockResolvedValueOnce(fakeEmbeddingResponse([vec]));

    const promise = emb.embedBatch(['hello']);

    // retry-after: 2 → 2000ms delay
    await vi.advanceTimersByTimeAsync(2100);

    const result = await promise;
    expect(result).toEqual([vec]);

    vi.useRealTimers();
  });
});
