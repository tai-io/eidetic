/**
 * Merge-time fact consolidation via LLM.
 *
 * When new facts merge into an existing query group, this module
 * summarizes old + new into a compact, non-overlapping set.
 *
 * Non-fatal — returns combined (unconsolidated) facts on any failure.
 */

import { getConfig } from '../config.js';
import { getConsolidationPrompt } from './prompts.js';
import type { ExtractedFact } from './types.js';

const VALID_KINDS = new Set<string>(['fact', 'decision', 'convention', 'constraint', 'intent']);

const CONSOLIDATION_TIMEOUT_MS = 15_000;

export async function consolidateFacts(
  existingFacts: ExtractedFact[],
  newFacts: ExtractedFact[],
  queryText: string,
  apiKey: string,
  model?: string,
): Promise<ExtractedFact[]> {
  const fallback = [...existingFacts, ...newFacts];

  const config = getConfig();
  const baseUrl = config.openaiBaseUrl ?? 'https://api.openai.com/v1';
  const llmModel = model ?? config.extractionModel;

  const userContent = formatConsolidationInput(existingFacts, newFacts, queryText);

  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => {
      controller.abort();
    }, CONSOLIDATION_TIMEOUT_MS);

    const response = await fetch(`${baseUrl}/chat/completions`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${apiKey}`,
      },
      body: JSON.stringify({
        model: llmModel,
        messages: [
          { role: 'system', content: getConsolidationPrompt() },
          { role: 'user', content: userContent },
        ],
        max_tokens: 1500,
        temperature: 0,
      }),
      signal: controller.signal,
    });

    clearTimeout(timeout);

    if (!response.ok) return fallback;

    const data = (await response.json()) as {
      choices: { message: { content: string } }[];
    };

    const raw = data.choices[0]?.message?.content ?? '';
    const parsed = parseAndValidate(raw);
    return parsed.length > 0 ? parsed : fallback;
  } catch {
    return fallback;
  }
}

function formatConsolidationInput(
  existing: ExtractedFact[],
  incoming: ExtractedFact[],
  queryText: string,
): string {
  const lines: string[] = [`Topic: "${queryText}"`, '', 'Existing facts:'];
  for (const f of existing) {
    const filesStr = f.files.length > 0 ? ` {${f.files.join(', ')}}` : '';
    lines.push(`- [${f.kind}] ${f.fact}${filesStr}`);
  }
  lines.push('', 'New facts:');
  for (const f of incoming) {
    const filesStr = f.files.length > 0 ? ` {${f.files.join(', ')}}` : '';
    lines.push(`- [${f.kind}] ${f.fact}${filesStr}`);
  }
  return lines.join('\n');
}

function parseAndValidate(raw: string): ExtractedFact[] {
  try {
    const parsed: unknown = JSON.parse(raw);
    if (!parsed || typeof parsed !== 'object') return [];

    const facts = (parsed as Record<string, unknown>).facts;
    if (!Array.isArray(facts)) return [];

    return facts
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
  } catch {
    return [];
  }
}
