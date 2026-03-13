/**
 * Parse and serialize the markdown memory file format.
 *
 * File format:
 * ---
 * id: <uuid>
 * query: "query text"
 * project: <project-name>
 * session_id: <session-id>
 * created_at: "ISO timestamp"
 * ---
 *
 * - [kind] fact text
 * - [kind] another fact
 */

import { parse as parseYaml, stringify as stringifyYaml } from 'yaml';
import { z } from 'zod';
import type { MemoryKind } from './types.js';

const MEMORY_KINDS: readonly MemoryKind[] = [
  'fact',
  'decision',
  'convention',
  'constraint',
  'intent',
];

const frontmatterSchema = z.object({
  id: z.string().uuid(),
  query: z.string().min(1),
  project: z.string().min(1),
  session_id: z.string().min(1),
  created_at: z.string().min(1),
});

export interface MemoryFileFact {
  kind: MemoryKind;
  text: string;
}

export interface MemoryFile {
  id: string;
  query: string;
  project: string;
  sessionId: string;
  createdAt: string;
  facts: MemoryFileFact[];
}

const FRONTMATTER_REGEX = /^---\n([\s\S]*?)\n---\n?([\s\S]*)$/;
const FACT_LINE_REGEX = /^- \[(\w+)] (.+)$/;

/**
 * Parse a markdown memory file. Returns null for unparseable files
 * (user may have corrupted the file, or it's not a memory file).
 */
export function parseMemoryFile(content: string): MemoryFile | null {
  const match = FRONTMATTER_REGEX.exec(content);
  if (!match) return null;

  const [, yamlBlock, body] = match;

  let parsed: unknown;
  try {
    parsed = parseYaml(yamlBlock);
  } catch {
    return null;
  }

  const result = frontmatterSchema.safeParse(parsed);
  if (!result.success) return null;

  const frontmatter = result.data;
  const facts: MemoryFileFact[] = [];

  for (const line of body.split('\n')) {
    const trimmed = line.trim();
    if (!trimmed) continue;

    const factMatch = FACT_LINE_REGEX.exec(trimmed);
    if (!factMatch) continue;

    const [, kind, text] = factMatch;
    if (MEMORY_KINDS.includes(kind as MemoryKind)) {
      facts.push({ kind: kind as MemoryKind, text });
    }
  }

  return {
    id: frontmatter.id,
    query: frontmatter.query,
    project: frontmatter.project,
    sessionId: frontmatter.session_id,
    createdAt: frontmatter.created_at,
    facts,
  };
}

/**
 * Serialize a MemoryFile to the markdown format.
 */
export function serializeMemoryFile(memory: MemoryFile): string {
  const frontmatter = stringifyYaml(
    {
      id: memory.id,
      query: memory.query,
      project: memory.project,
      session_id: memory.sessionId,
      created_at: memory.createdAt,
    },
    { lineWidth: 0 },
  ).trimEnd();

  const factLines = memory.facts.map((f) => `- [${f.kind}] ${f.text}`);

  return `---\n${frontmatter}\n---\n\n${factLines.join('\n')}\n`;
}
