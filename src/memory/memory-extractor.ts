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
import type { BufferItem, ExtractionResult, ExtractionGroup, ExtractedFact } from './types.js';

const VALID_KINDS = new Set<string>(['fact', 'decision', 'convention', 'constraint', 'intent']);

const EXTRACTION_TIMEOUT_MS = 15_000;

const SYSTEM_PROMPT = `You extract durable knowledge from developer session observations, grouped by the user query that prompted them.

Input: A list of items captured during a coding session. Items marked [user-query] are the user's original questions/intents. Other items are tool outputs, URLs, commands, etc.

Your job:
1. **Group** items by the user query they relate to. If an item doesn't clearly relate to any user query, create a descriptive query for it.
2. **Extract** durable facts from each group: decisions made, conventions discovered, constraints identified, facts learned.
3. **Filter** noise: skip transient debugging details, trivial fixes, duplicate info, session-specific state.
4. **Classify** each fact by kind: fact, decision, convention, constraint, intent.

Output ONLY valid JSON:
{
  "groups": [
    {
      "query": "the user's original question or intent",
      "facts": [
        {"fact": "clear reusable statement", "kind": "fact|decision|convention|constraint|intent"}
      ]
    }
  ]
}

Examples of GOOD extraction:
- User asked about auth → facts: "Project uses JWT tokens", "bcrypt for password hashing in auth.ts"
- User fetched a URL that 404'd → fact: "API docs moved from /v1/docs to /v2/docs"
- User ran npm install lodash → fact: "Installed lodash via npm"

Skip groups with no durable facts. Output ONLY the JSON object, no other text.`;

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
    .map((item, i) => `${i + 1}. [${item.source}/${item.tool_name ?? 'unknown'}] ${item.content}`)
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
          { role: 'system', content: SYSTEM_PROMPT },
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
    const parsed = JSON.parse(raw) as Record<string, unknown>;
    if (typeof parsed !== 'object' || parsed === null) {
      return { groups: [] };
    }

    const groups = validateGroups(parsed.groups);
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
  return raw.filter((entry): entry is ExtractedFact => {
    if (typeof entry !== 'object' || entry === null) return false;
    const e = entry as Record<string, unknown>;
    return (
      typeof e.fact === 'string' &&
      e.fact.length > 0 &&
      typeof e.kind === 'string' &&
      VALID_KINDS.has(e.kind)
    );
  });
}
