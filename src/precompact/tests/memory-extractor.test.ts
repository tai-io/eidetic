import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import type { ExtractedMemory } from '../memory-extractor.js';

// Mock global fetch
const mockFetch = vi.fn();
vi.stubGlobal('fetch', mockFetch);

describe('extractMemoriesFromTranscript', () => {
  let extractMemoriesFromTranscript: typeof import('../memory-extractor.js').extractMemoriesFromTranscript;

  beforeEach(async () => {
    vi.resetModules();
    mockFetch.mockReset();
    const mod = await import('../memory-extractor.js');
    extractMemoriesFromTranscript = mod.extractMemoriesFromTranscript;
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  function mockLlmResponse(memories: ExtractedMemory[]): void {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({
        choices: [{ message: { content: JSON.stringify(memories) } }],
      }),
    });
  }

  it('returns parsed memories from valid LLM response', async () => {
    const memories: ExtractedMemory[] = [
      { content: 'project uses bcrypt for password hashing', kind: 'fact' },
      { content: 'chose JWT over session cookies for stateless auth', kind: 'decision' },
    ];
    mockLlmResponse(memories);

    const result = await extractMemoriesFromTranscript('some session note text', 'test-api-key');

    expect(result).toHaveLength(2);
    expect(result[0].content).toBe('project uses bcrypt for password hashing');
    expect(result[0].kind).toBe('fact');
    expect(result[1].kind).toBe('decision');
  });

  it('returns empty array on invalid JSON response', async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({
        choices: [{ message: { content: 'not valid json at all' } }],
      }),
    });

    const result = await extractMemoriesFromTranscript('session text', 'test-api-key');
    expect(result).toEqual([]);
  });

  it('returns empty array on HTTP error', async () => {
    mockFetch.mockResolvedValueOnce({
      ok: false,
      status: 500,
      statusText: 'Internal Server Error',
    });

    const result = await extractMemoriesFromTranscript('session text', 'test-api-key');
    expect(result).toEqual([]);
  });

  it('returns empty array on fetch rejection (timeout/network)', async () => {
    mockFetch.mockRejectedValueOnce(new Error('AbortError'));

    const result = await extractMemoriesFromTranscript('session text', 'test-api-key');
    expect(result).toEqual([]);
  });

  it('filters out entries with invalid kind', async () => {
    mockLlmResponse([
      { content: 'valid fact', kind: 'fact' },
      { content: 'bad kind', kind: 'invalid_kind' as ExtractedMemory['kind'] },
      { content: 'valid decision', kind: 'decision' },
    ]);

    const result = await extractMemoriesFromTranscript('session text', 'test-api-key');
    expect(result).toHaveLength(2);
    expect(result.map((m) => m.content)).toEqual(['valid fact', 'valid decision']);
  });

  it('filters out entries without content', async () => {
    mockLlmResponse([
      { content: '', kind: 'fact' },
      { content: 'valid', kind: 'convention' },
    ]);

    const result = await extractMemoriesFromTranscript('session text', 'test-api-key');
    expect(result).toHaveLength(1);
    expect(result[0].content).toBe('valid');
  });

  it('returns empty array for empty session text', async () => {
    const result = await extractMemoriesFromTranscript('', 'test-api-key');
    expect(result).toEqual([]);
    expect(mockFetch).not.toHaveBeenCalled();
  });

  it('sends session note text to LLM', async () => {
    mockLlmResponse([]);

    await extractMemoriesFromTranscript('my session note content', 'test-api-key');

    expect(mockFetch).toHaveBeenCalledOnce();
    const body = JSON.parse(mockFetch.mock.calls[0][1].body);
    expect(body.messages[1].content).toContain('my session note content');
  });
});
