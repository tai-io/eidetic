/**
 * Extract query-grouped facts from buffered items via LLM.
 *
 * Takes raw buffer items (user queries + tool outputs) and produces
 * query→facts groups. No knowledge of existing memories — dedup is
 * handled separately by the store.
 *
 * Non-fatal — returns empty result on any failure.
 */

import { getConfig } from '../config.js';
import { getExtractionPrompt } from './prompts.js';
import type { BufferItem, ExtractionResult, ExtractionGroup, ExtractedFact } from './types.js';

const VALID_KINDS = new Set<string>(['fact', 'decision', 'convention', 'constraint', 'intent']);

const EXTRACTION_TIMEOUT_MS = 15_000;

export async function extractMemories(
  items: BufferItem[],
  apiKey: string,
  model?: string,
): Promise<ExtractionResult> {
  const empty: ExtractionResult = { groups: [] };
  if (items.length === 0) return empty;

  const config = getConfig();
  const baseUrl = config.openaiBaseUrl ?? 'https://api.openai.com/v1';
  const llmModel = model ?? config.extractionModel;

  const userContent = items
    .map((item, i) => {
      let line = `${i + 1}. [${item.source}/${item.tool_name ?? 'unknown'}] ${item.content}`;
      if (item.file_paths) {
        line += ` | files: ${item.file_paths}`;
      }
      if (item.raw_output) {
        const truncated = item.raw_output.slice(0, 500);
        line += `\n   raw: ${truncated}`;
      }
      return line;
    })
    .join('\n');

  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => {
      controller.abort();
    }, EXTRACTION_TIMEOUT_MS);

    const response = await fetch(`${baseUrl}/chat/completions`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${apiKey}`,
      },
      body: JSON.stringify({
        model: llmModel,
        messages: [
          { role: 'system', content: getExtractionPrompt() },
          { role: 'user', content: userContent },
        ],
        max_tokens: 1500,
        temperature: 0,
      }),
      signal: controller.signal,
    });

    clearTimeout(timeout);

    if (!response.ok) return empty;

    const data = (await response.json()) as {
      choices: { message: { content: string } }[];
    };

    const raw = data.choices[0]?.message?.content ?? '';
    return parseAndValidate(raw);
  } catch {
    return empty;
  }
}

function parseAndValidate(raw: string): ExtractionResult {
  try {
    const parsed: unknown = JSON.parse(raw);
    if (!parsed || typeof parsed !== 'object') {
      return { groups: [] };
    }

    const groups = validateGroups((parsed as Record<string, unknown>).groups);
    return { groups };
  } catch {
    return { groups: [] };
  }
}

function validateGroups(raw: unknown): ExtractionGroup[] {
  if (!Array.isArray(raw)) return [];

  return raw
    .filter((entry): entry is Record<string, unknown> => {
      if (typeof entry !== 'object' || entry === null) return false;
      const e = entry as Record<string, unknown>;
      return typeof e.query === 'string' && e.query.length > 0 && Array.isArray(e.facts);
    })
    .map((entry) => ({
      query: entry.query as string,
      facts: validateFacts(entry.facts as unknown[]),
    }))
    .filter((group) => group.facts.length > 0);
}

function validateFacts(raw: unknown[]): ExtractedFact[] {
  return raw
    .filter((entry): entry is Record<string, unknown> => {
      if (typeof entry !== 'object' || entry === null) return false;
      const e = entry as Record<string, unknown>;
      return (
        typeof e.fact === 'string' &&
        e.fact.length > 0 &&
        typeof e.kind === 'string' &&
        VALID_KINDS.has(e.kind)
      );
    })
    .map((e) => ({
      fact: e.fact as string,
      kind: e.kind as ExtractedFact['kind'],
      files: Array.isArray(e.files)
        ? (e.files as unknown[]).filter((f): f is string => typeof f === 'string')
        : [],
    }));
}
