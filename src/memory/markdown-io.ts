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
 * tags: [fact, decision]           # optional, Obsidian-compatible
 * aliases: ["query text"]          # optional, Obsidian-compatible
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
  tags: z.array(z.string()).optional(),
  aliases: z.array(z.string()).optional(),
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
  tags?: string[];
  aliases?: string[];
}

const FRONTMATTER_REGEX = /^---\n([\s\S]*?)\n---\n?([\s\S]*)$/;
const FACT_LINE_REGEX = /^- \[(\w+)] (.+)$/;

/**
 * Parse a markdown memory file. Returns null for unparseable files
 * (user may have corrupted the file, or it's not a memory file).
 */
export function parseMemoryFile(content: string): MemoryFile | null {
  const match = FRONTMATTER_REGEX.exec(content);
  if (!match || match.length < 3) return null;

  const yamlBlock = match[1] as string;
  const body = match[2] as string;

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
    if (!factMatch || factMatch.length < 3) continue;

    const kind = factMatch[1] as string;
    const text = factMatch[2] as string;
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
    tags: frontmatter.tags,
    aliases: frontmatter.aliases,
  };
}

/**
 * Serialize a MemoryFile to the markdown format.
 */
export function serializeMemoryFile(memory: MemoryFile): string {
  const frontmatterObj: Record<string, unknown> = {
    id: memory.id,
    query: memory.query,
    project: memory.project,
    session_id: memory.sessionId,
    created_at: memory.createdAt,
  };

  // Only include tags/aliases if present — avoids re-injecting defaults
  // when re-serializing a user-edited file that removed them
  if (memory.tags) {
    frontmatterObj.tags = memory.tags;
  }
  if (memory.aliases) {
    frontmatterObj.aliases = memory.aliases;
  }

  const frontmatter = stringifyYaml(frontmatterObj, { lineWidth: 0 }).trimEnd();

  const factLines = memory.facts.map((f) => `- [${f.kind}] ${f.text}`);

  return `---\n${frontmatter}\n---\n\n${factLines.join('\n')}\n`;
}
