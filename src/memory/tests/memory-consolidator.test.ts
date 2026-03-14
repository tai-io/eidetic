import { describe, it, expect, vi, beforeEach } from 'vitest';
import { consolidateFacts } from '../memory-consolidator.js';
import type { ExtractedFact } from '../types.js';

// Mock global fetch
const mockFetch = vi.fn();
vi.stubGlobal('fetch', mockFetch);

// Mock getConfig
vi.mock('../../config.js', () => ({
  getConfig: () => ({
    openaiBaseUrl: 'https://api.openai.com/v1',
    extractionModel: 'gpt-4o-mini',
  }),
}));

function mockLLMResponse(facts: ExtractedFact[]): void {
  mockFetch.mockResolvedValueOnce({
    ok: true,
    json: async () => ({
      choices: [{ message: { content: JSON.stringify({ facts }) } }],
    }),
  });
}

describe('consolidateFacts', () => {
  beforeEach(() => {
    mockFetch.mockReset();
  });

  it('merges duplicate facts into a consolidated set', async () => {
    const existing: ExtractedFact[] = [
      { fact: 'Uses TypeScript strict mode', kind: 'convention', files: ['tsconfig.json'] },
      { fact: 'ESM only, no CommonJS', kind: 'convention', files: [] },
    ];
    const incoming: ExtractedFact[] = [
      { fact: 'TypeScript strict mode is enabled', kind: 'convention', files: ['tsconfig.json'] },
      { fact: 'Prettier for formatting', kind: 'convention', files: ['.prettierrc'] },
    ];

    // Mock LLM returns consolidated set
    mockLLMResponse([
      { fact: 'Uses TypeScript strict mode', kind: 'convention', files: ['tsconfig.json'] },
      { fact: 'ESM only, no CommonJS', kind: 'convention', files: [] },
      { fact: 'Prettier for formatting', kind: 'convention', files: ['.prettierrc'] },
    ]);

    const result = await consolidateFacts(existing, incoming, 'TypeScript conventions', 'test-key');
    expect(result).toHaveLength(3);
    expect(result.map((f) => f.fact)).toContain('Uses TypeScript strict mode');
    expect(result.map((f) => f.fact)).toContain('Prettier for formatting');
  });

  it('preserves file paths from LLM response', async () => {
    const existing: ExtractedFact[] = [
      { fact: 'Auth uses JWT', kind: 'fact', files: ['src/auth.ts'] },
    ];
    const incoming: ExtractedFact[] = [
      { fact: 'JWT tokens expire in 24h', kind: 'fact', files: ['src/auth.ts'] },
    ];

    mockLLMResponse([
      { fact: 'Auth uses JWT with 24h expiry', kind: 'fact', files: ['src/auth.ts'] },
    ]);

    const result = await consolidateFacts(existing, incoming, 'Auth system', 'test-key');
    expect(result).toHaveLength(1);
    expect(result[0].files).toEqual(['src/auth.ts']);
  });

  it('returns combined facts on LLM failure', async () => {
    const existing: ExtractedFact[] = [{ fact: 'Fact A', kind: 'fact', files: [] }];
    const incoming: ExtractedFact[] = [{ fact: 'Fact B', kind: 'fact', files: [] }];

    mockFetch.mockResolvedValueOnce({ ok: false });

    const result = await consolidateFacts(existing, incoming, 'query', 'test-key');
    // Fallback: return both without consolidation
    expect(result).toHaveLength(2);
    expect(result.map((f) => f.fact)).toEqual(['Fact A', 'Fact B']);
  });

  it('returns combined facts on network error', async () => {
    const existing: ExtractedFact[] = [{ fact: 'Fact A', kind: 'fact', files: [] }];
    const incoming: ExtractedFact[] = [{ fact: 'Fact B', kind: 'fact', files: [] }];

    mockFetch.mockRejectedValueOnce(new Error('network error'));

    const result = await consolidateFacts(existing, incoming, 'query', 'test-key');
    expect(result).toHaveLength(2);
  });

  it('validates LLM output and filters invalid entries', async () => {
    const existing: ExtractedFact[] = [{ fact: 'Fact A', kind: 'fact', files: [] }];
    const incoming: ExtractedFact[] = [{ fact: 'Fact B', kind: 'decision', files: [] }];

    // LLM returns one valid and one invalid fact
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({
        choices: [
          {
            message: {
              content: JSON.stringify({
                facts: [
                  { fact: 'Valid fact', kind: 'fact', files: [] },
                  { fact: '', kind: 'invalid-kind', files: [] }, // invalid
                ],
              }),
            },
          },
        ],
      }),
    });

    const result = await consolidateFacts(existing, incoming, 'query', 'test-key');
    expect(result).toHaveLength(1);
    expect(result[0].fact).toBe('Valid fact');
  });

  it('accepts custom model parameter', async () => {
    mockLLMResponse([{ fact: 'Consolidated', kind: 'fact', files: [] }]);

    await consolidateFacts(
      [{ fact: 'A', kind: 'fact', files: [] }],
      [{ fact: 'B', kind: 'fact', files: [] }],
      'query',
      'test-key',
      'gpt-4o',
    );

    const body = JSON.parse(mockFetch.mock.calls[0][1].body as string) as { model: string };
    expect(body.model).toBe('gpt-4o');
  });
});
