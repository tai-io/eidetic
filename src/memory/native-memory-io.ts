/**
 * Read/write memory files in Claude Code's native memory format.
 *
 * Native memory files live in ~/.claude/projects/<project>/memory/
 * with YAML frontmatter (name, description, type) and freeform markdown body.
 */

import fs from 'node:fs';
import path from 'node:path';
import { parse as parseYaml, stringify as stringifyYaml } from 'yaml';
import { z } from 'zod';
import { slugify, resolveSlugCollision } from './slug.js';
import { writeFileAtomic } from '../precompact/utils.js';

const MEMORY_TYPES = ['user', 'feedback', 'project', 'reference'] as const;
type MemoryType = (typeof MEMORY_TYPES)[number];

export interface NativeMemory {
  name: string;
  description: string;
  type: MemoryType;
  content: string;
}

export interface WriteResult {
  filename: string;
  filePath: string;
}

const FRONTMATTER_REGEX = /^---\n([\s\S]*?)\n---\n?([\s\S]*)$/;

const frontmatterSchema = z.object({
  name: z.string().min(1),
  description: z.string().min(1),
  type: z.enum(MEMORY_TYPES),
});

/**
 * Write a memory file in native Claude Code format.
 * Creates the memory directory if needed.
 * Returns the filename and full path.
 */
export function writeNativeMemory(
  memoryDir: string,
  name: string,
  description: string,
  type: MemoryType,
  content: string,
): WriteResult {
  fs.mkdirSync(memoryDir, { recursive: true });

  const baseSlug = slugify(name);
  const existingSlugs = buildExistingSlugSet(memoryDir);
  const finalSlug = resolveSlugCollision(baseSlug, existingSlugs);
  const filename = `${finalSlug}.md`;
  const filePath = path.join(memoryDir, filename);

  const frontmatter = stringifyYaml({ name, description, type }, { lineWidth: 0 }).trimEnd();
  const fileContent = `---\n${frontmatter}\n---\n\n${content}\n`;

  writeFileAtomic(filePath, fileContent);

  return { filename, filePath };
}

/**
 * Update MEMORY.md index with a new entry.
 * Idempotent — won't add if entry for filename already exists.
 */
export function updateMemoryIndex(
  memoryDir: string,
  filename: string,
  description: string,
): void {
  const indexPath = path.join(memoryDir, 'MEMORY.md');
  const entry = `- [${filename}](${filename}) — ${description}`;

  const existing = readFileOrEmpty(indexPath);

  if (existing.includes(`[${filename}]`)) return;

  const newContent = existing.length > 0 ? `${existing}${entry}\n` : `${entry}\n`;
  writeFileAtomic(indexPath, newContent);
}

/**
 * Read and parse a native memory file.
 * Returns null if file doesn't exist.
 */
export function readNativeMemory(memoryDir: string, filename: string): NativeMemory | null {
  const filePath = path.join(memoryDir, filename);

  if (!fs.existsSync(filePath)) return null;

  const raw = fs.readFileSync(filePath, 'utf-8');
  return parseNativeMemoryContent(raw);
}

/**
 * List all memory files in a directory (excludes MEMORY.md).
 */
export function listNativeMemories(memoryDir: string): string[] {
  if (!fs.existsSync(memoryDir)) return [];

  return fs
    .readdirSync(memoryDir)
    .filter((f) => f.endsWith('.md') && f !== 'MEMORY.md');
}

// --- Internal helpers ---

function buildExistingSlugSet(memoryDir: string): Set<string> {
  if (!fs.existsSync(memoryDir)) return new Set();

  const files = fs.readdirSync(memoryDir).filter((f) => f.endsWith('.md'));
  return new Set(files.map((f) => f.replace(/\.md$/, '')));
}

function readFileOrEmpty(filePath: string): string {
  try {
    return fs.readFileSync(filePath, 'utf-8');
  } catch {
    return '';
  }
}

function parseNativeMemoryContent(raw: string): NativeMemory | null {
  const match = FRONTMATTER_REGEX.exec(raw);
  if (!match) return null;

  const yamlBlock = match[1];
  if (!yamlBlock) return null;
  const body = match[2];

  let parsed: unknown;
  try {
    parsed = parseYaml(yamlBlock);
  } catch {
    return null;
  }

  const result = frontmatterSchema.safeParse(parsed);
  if (!result.success) return null;

  // Strip leading newline from body (separator after frontmatter)
  const content = body.startsWith('\n') ? body.slice(1) : body;

  return {
    name: result.data.name,
    description: result.data.description,
    type: result.data.type,
    content,
  };
}
