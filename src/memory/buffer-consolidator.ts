/**
 * Consolidate buffered facts via LLM: classify, merge, filter noise, extract graph triples.
 * Non-fatal — returns empty result on any failure.
 */

import { getConfig } from '../config.js';
import type {
  BufferItem,
  ConsolidationResult,
  ExtractedFact,
  GraphTriple,
  NodeType,
  RelationType,
  MemoryKind,
} from './types.js';

const VALID_KINDS = new Set<string>(['fact', 'decision', 'convention', 'constraint', 'intent']);

const VALID_NODE_TYPES = new Set<string>([
  'file',
  'function',
  'class',
  'module',
  'decision',
  'convention',
  'constraint',
  'project',
]);

const VALID_RELATION_TYPES = new Set<string>([
  'imports',
  'calls',
  'depends_on',
  'contains',
  'motivates',
  'contradicts',
  'supersedes',
  'applies_to',
  'related_to',
]);

const CONSOLIDATION_TIMEOUT_MS = 15_000;

const SYSTEM_PROMPT = `You consolidate raw developer observations into reusable knowledge and a knowledge graph.

Input: A list of raw facts captured during a coding session (from tool outputs, URLs, commands).

Your job:
1. **Merge** related facts into single, clear statements
2. **Classify** each by kind: fact, decision, convention, constraint, intent
3. **Filter** noise: skip session-specific debugging details, trivial fixes, duplicate info
4. **Extract graph triples**: identify entity relationships (files, functions, classes, modules, decisions, conventions)

Output ONLY valid JSON with this structure:
{
  "memories": [{"fact": "clear reusable statement", "kind": "fact|decision|convention|constraint|intent"}],
  "graph": [{"source": {"name": "entity", "type": "file|function|class|module|decision|convention|constraint|project"}, "relationship": "imports|calls|depends_on|contains|motivates|contradicts|supersedes|applies_to|related_to", "target": {"name": "entity", "type": "file|function|class|module|decision|convention|constraint|project"}}]
}

Examples of GOOD consolidation:
- 3 facts about auth → 1 memory: "Project uses JWT with bcrypt password hashing in auth.ts"
- URL 404 + redirect → 1 memory: "API docs moved from /v1/docs to /v2/docs"

Output ONLY the JSON object, no other text.`;

export async function consolidateBuffer(
  items: BufferItem[],
  apiKey: string,
  model?: string,
): Promise<ConsolidationResult> {
  const empty: ConsolidationResult = { memories: [], graph: [] };
  if (items.length === 0) return empty;

  const config = getConfig();
  const baseUrl = config.openaiBaseUrl ?? 'https://api.openai.com/v1';
  const llmModel = model ?? config.raptorLlmModel;

  const userContent = items
    .map((item, i) => `${i + 1}. [${item.source}/${item.tool_name ?? 'unknown'}] ${item.content}`)
    .join('\n');

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
          { role: 'system', content: SYSTEM_PROMPT },
          { role: 'user', content: userContent },
        ],
        max_tokens: 1000,
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

function parseAndValidate(raw: string): ConsolidationResult {
  try {
    const parsed = JSON.parse(raw) as Record<string, unknown>;
    if (typeof parsed !== 'object' || parsed === null) {
      return { memories: [], graph: [] };
    }

    const memories = validateMemories(parsed.memories);
    const graph = validateTriples(parsed.graph);

    return { memories, graph };
  } catch {
    return { memories: [], graph: [] };
  }
}

function validateMemories(raw: unknown): ExtractedFact[] {
  if (!Array.isArray(raw)) return [];
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

function validateTriples(raw: unknown): GraphTriple[] {
  if (!Array.isArray(raw)) return [];
  return raw.filter((entry): entry is GraphTriple => {
    if (typeof entry !== 'object' || entry === null) return false;
    const e = entry as Record<string, unknown>;

    const source = e.source as Record<string, unknown> | undefined;
    const target = e.target as Record<string, unknown> | undefined;

    if (!source || typeof source.name !== 'string' || !VALID_NODE_TYPES.has(source.type as string))
      return false;
    if (!target || typeof target.name !== 'string' || !VALID_NODE_TYPES.has(target.type as string))
      return false;
    if (typeof e.relationship !== 'string' || !VALID_RELATION_TYPES.has(e.relationship))
      return false;

    // Cast validated types
    (source as { type: NodeType }).type = source.type as NodeType;
    (target as { type: NodeType }).type = target.type as NodeType;
    (e as { relationship: RelationType }).relationship = e.relationship as RelationType;

    return true;
  });
}
