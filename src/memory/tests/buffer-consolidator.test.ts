import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { consolidateBuffer } from '../buffer-consolidator.js';
import type { BufferItem, ConsolidationResult } from '../types.js';

function makeItem(overrides: Partial<BufferItem> = {}): BufferItem {
  return {
    id: 1,
    session_id: 'sess-1',
    content: 'URL https://example.com returned 404',
    source: 'post-tool-extract',
    tool_name: 'WebFetch',
    project: 'my-project',
    captured_at: '2026-03-04T10:00:00Z',
    ...overrides,
  };
}

function makeLlmResponse(result: ConsolidationResult): object {
  return {
    choices: [
      {
        message: {
          content: JSON.stringify(result),
        },
      },
    ],
  };
}

describe('consolidateBuffer', () => {
  beforeEach(() => {
    vi.stubGlobal('fetch', vi.fn());
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('returns empty result for empty items', async () => {
    const result = await consolidateBuffer([], 'sk-test');
    expect(result.memories).toEqual([]);
    expect(result.graph).toEqual([]);
  });

  it('calls OpenAI and parses consolidated memories + graph triples', async () => {
    const llmResult: ConsolidationResult = {
      memories: [{ fact: 'Project uses bcrypt for hashing', kind: 'fact' }],
      graph: [
        {
          source: { name: 'auth.ts', type: 'file' },
          relationship: 'contains',
          target: { name: 'hashPassword', type: 'function' },
        },
      ],
    };

    const mockFetch = vi.fn().mockResolvedValue({
      ok: true,
      json: () => Promise.resolve(makeLlmResponse(llmResult)),
    });
    vi.stubGlobal('fetch', mockFetch);

    const result = await consolidateBuffer(
      [makeItem({ content: 'auth.ts uses bcrypt, hashPassword function' })],
      'sk-test',
    );

    expect(result.memories).toHaveLength(1);
    expect(result.memories[0].fact).toBe('Project uses bcrypt for hashing');
    expect(result.memories[0].kind).toBe('fact');
    expect(result.graph).toHaveLength(1);
    expect(result.graph[0].relationship).toBe('contains');
  });

  it('returns empty on non-ok response', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: false, status: 500 }));

    const result = await consolidateBuffer([makeItem()], 'sk-test');
    expect(result.memories).toEqual([]);
    expect(result.graph).toEqual([]);
  });

  it('returns empty on network error', async () => {
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('network down')));

    const result = await consolidateBuffer([makeItem()], 'sk-test');
    expect(result.memories).toEqual([]);
    expect(result.graph).toEqual([]);
  });

  it('returns empty on invalid JSON from LLM', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({
        ok: true,
        json: () =>
          Promise.resolve({
            choices: [{ message: { content: 'not valid json {{{' } }],
          }),
      }),
    );

    const result = await consolidateBuffer([makeItem()], 'sk-test');
    expect(result.memories).toEqual([]);
    expect(result.graph).toEqual([]);
  });

  it('filters out memories with invalid kind', async () => {
    const llmResult = {
      memories: [
        { fact: 'valid', kind: 'fact' },
        { fact: 'bad kind', kind: 'nonsense' },
      ],
      graph: [],
    };

    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({
        ok: true,
        json: () => Promise.resolve(makeLlmResponse(llmResult as ConsolidationResult)),
      }),
    );

    const result = await consolidateBuffer([makeItem()], 'sk-test');
    expect(result.memories).toHaveLength(1);
    expect(result.memories[0].fact).toBe('valid');
  });

  it('filters out graph triples with invalid types', async () => {
    const llmResult = {
      memories: [],
      graph: [
        {
          source: { name: 'a', type: 'file' },
          relationship: 'imports',
          target: { name: 'b', type: 'file' },
        },
        {
          source: { name: 'x', type: 'banana' },
          relationship: 'calls',
          target: { name: 'y', type: 'file' },
        },
      ],
    };

    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({
        ok: true,
        json: () => Promise.resolve(makeLlmResponse(llmResult as ConsolidationResult)),
      }),
    );

    const result = await consolidateBuffer([makeItem()], 'sk-test');
    expect(result.graph).toHaveLength(1);
    expect(result.graph[0].source.name).toBe('a');
  });

  it('includes item contents in the user message to LLM', async () => {
    const mockFetch = vi.fn().mockResolvedValue({
      ok: true,
      json: () => Promise.resolve(makeLlmResponse({ memories: [], graph: [] })),
    });
    vi.stubGlobal('fetch', mockFetch);

    await consolidateBuffer(
      [makeItem({ content: 'fact alpha' }), makeItem({ id: 2, content: 'fact beta' })],
      'sk-test',
    );

    const body = JSON.parse(mockFetch.mock.calls[0][1].body as string) as {
      messages: { content: string }[];
    };
    const userContent = body.messages[1].content;
    expect(userContent).toContain('fact alpha');
    expect(userContent).toContain('fact beta');
  });
});
