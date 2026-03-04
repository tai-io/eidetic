/**
 * Extract reusable developer knowledge from session notes using LLM.
 * Non-fatal — returns empty array on any failure.
 */

import { getConfig } from '../config.js';
import type { MemoryKind } from '../memory/types.js';

const VALID_KINDS = new Set<string>(['fact', 'decision', 'convention', 'constraint', 'intent']);

const EXTRACTION_TIMEOUT_MS = 15_000;

export interface ExtractedMemory {
  content: string;
  kind: MemoryKind;
  valid_at?: string;
}

const SYSTEM_PROMPT = `Extract reusable developer knowledge from this session note. Output a JSON array of objects with {content, kind} where kind is one of: fact, decision, convention, constraint, intent.

Only extract clear, specific, reusable knowledge — not session-specific details.

Examples of GOOD extractions (reusable knowledge):
- {"content": "project uses bcrypt for password hashing", "kind": "fact"}
- {"content": "chose JWT over session cookies for stateless auth", "kind": "decision"}
- {"content": "all API responses use snake_case keys", "kind": "convention"}

Examples of BAD extractions (session artifacts — do NOT extract these):
- "user debugged a TypeError in auth.ts line 42" (session-specific debugging)
- "assistant suggested refactoring the login function" (suggestion, not confirmed decision)
- "fixed a typo in the README" (trivial, not reusable)

Output ONLY the JSON array, no other text.`;

/**
 * Extract memories from session note text (produced by writeSessionNote).
 * Uses the session note rather than raw transcript to get a summary of the
 * whole session, avoiding bias toward conversation start or end.
 */
export async function extractMemoriesFromTranscript(
  sessionNoteText: string,
  apiKey: string,
  model?: string,
): Promise<ExtractedMemory[]> {
  if (!sessionNoteText.trim()) return [];

  const config = getConfig();
  const baseUrl = config.openaiBaseUrl ?? 'https://api.openai.com/v1';
  const llmModel = model ?? config.raptorLlmModel;

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
          { role: 'user', content: sessionNoteText.slice(0, 8000) },
        ],
        max_tokens: 500,
        temperature: 0,
      }),
      signal: controller.signal,
    });

    clearTimeout(timeout);

    if (!response.ok) return [];

    const data = (await response.json()) as {
      choices: { message: { content: string } }[];
    };

    const raw = data.choices[0]?.message?.content ?? '';
    return parseAndValidate(raw);
  } catch {
    return [];
  }
}

function parseAndValidate(raw: string): ExtractedMemory[] {
  try {
    const parsed = JSON.parse(raw) as unknown[];
    if (!Array.isArray(parsed)) return [];

    return parsed.filter((entry): entry is ExtractedMemory => {
      if (typeof entry !== 'object' || entry === null) return false;
      const e = entry as Record<string, unknown>;
      return (
        typeof e.content === 'string' &&
        e.content.length > 0 &&
        typeof e.kind === 'string' &&
        VALID_KINDS.has(e.kind)
      );
    });
  } catch {
    return [];
  }
}
