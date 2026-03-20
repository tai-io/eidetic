/**
 * Migrate v2 Eidetic memories (~/.eidetic/memories/<project>/)
 * to Claude Code native memory format (~/.claude/projects/<project>/memory/).
 *
 * Idempotent — uses a sentinel file (.v3-migrated) per project.
 */

import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';

const SENTINEL = '.v3-migrated';

interface V2Memory {
  query: string;
  slug: string;
  project: string;
  facts: { kind: string; text: string }[];
}

export interface MigrateResult {
  projectsMigrated: number;
  projectsSkipped: number;
  memoriesMigrated: number;
}

type NativeType = 'user' | 'feedback' | 'project' | 'reference';

const KIND_TO_TYPE: Record<string, NativeType> = {
  fact: 'project',
  decision: 'project',
  convention: 'feedback',
  constraint: 'feedback',
  intent: 'project',
};

const FRONTMATTER_REGEX = /^---\n([\s\S]*?)\n---/;
const FIELD_REGEX = (field: string): RegExp => new RegExp(`^${field}:\\s*"?([^"\\n]+)"?`, 'm');
const FACT_LINE_REGEX = /^- \*\*\[(\w+)]\*\* (.+)$/;

/**
 * Map v2 fact kind to v3 memory type.
 */
export function mapKindToType(kind: string): NativeType {
  return KIND_TO_TYPE[kind] ?? 'project';
}

/**
 * Parse a v2 memory file into structured data.
 * Returns null for unparseable files.
 */
export function parseV2Memory(content: string): V2Memory | null {
  const fmMatch = FRONTMATTER_REGEX.exec(content);
  if (!fmMatch) return null;

  const frontmatter = fmMatch[1];
  if (!frontmatter) return null;

  const query = extractField(frontmatter, 'query');
  const slug = extractField(frontmatter, 'slug');
  const project = extractField(frontmatter, 'project');

  if (!query || !slug || !project) return null;

  const facts: { kind: string; text: string }[] = [];
  const lines = content.split('\n');
  for (const line of lines) {
    const factMatch = FACT_LINE_REGEX.exec(line.trim());
    if (!factMatch) continue;
    const kind = factMatch[1];
    const text = factMatch[2];
    if (kind && text) {
      facts.push({ kind, text });
    }
  }

  return { query, slug, project, facts };
}

function extractField(frontmatter: string, field: string): string | null {
  const regex = FIELD_REGEX(field);
  const match = regex.exec(frontmatter);
  if (!match) return null;
  const value = match[1];
  if (!value) return null;
  return value.trim();
}

/**
 * Determine the dominant v3 type from a list of facts.
 */
function dominantType(facts: { kind: string }[]): NativeType {
  if (facts.length === 0) return 'project';

  const counts = new Map<NativeType, number>();
  for (const f of facts) {
    const t = mapKindToType(f.kind);
    counts.set(t, (counts.get(t) ?? 0) + 1);
  }

  let best: NativeType = 'project';
  let bestCount = 0;
  for (const [t, c] of counts) {
    if (c > bestCount) {
      best = t;
      bestCount = c;
    }
  }
  return best;
}

/**
 * Serialize a single v2 memory to native v3 format.
 */
function toNativeFormat(mem: V2Memory): string {
  const nativeType = dominantType(mem.facts);
  const lines = [
    '---',
    `name: ${mem.slug}`,
    `description: ${mem.query}`,
    `type: ${nativeType}`,
    '---',
    '',
  ];

  if (mem.facts.length > 0) {
    for (const f of mem.facts) {
      lines.push(`- ${f.text}`);
    }
    lines.push('');
  }

  return lines.join('\n');
}

/**
 * Migrate a single project's v2 memories to native format.
 * Returns the number of memories migrated.
 */
function migrateProject(
  v2ProjectDir: string,
  nativeMemDir: string,
): { migrated: number; entries: { filename: string; description: string }[] } {
  const files = fs.readdirSync(v2ProjectDir).filter((f) => f.endsWith('.md'));
  let migrated = 0;
  const entries: { filename: string; description: string }[] = [];

  for (const file of files) {
    const content = fs.readFileSync(path.join(v2ProjectDir, file), 'utf-8');
    const parsed = parseV2Memory(content);
    if (!parsed) continue;

    const filename = `${parsed.slug}.md`;
    const targetPath = path.join(nativeMemDir, filename);

    // Preserve existing native memories — never overwrite
    if (fs.existsSync(targetPath)) {
      continue;
    }

    fs.mkdirSync(nativeMemDir, { recursive: true });
    fs.writeFileSync(targetPath, toNativeFormat(parsed), 'utf-8');
    entries.push({ filename, description: parsed.query });
    migrated++;
  }

  return { migrated, entries };
}

/**
 * Update MEMORY.md with new entries (append, don't overwrite).
 */
function updateMemoryIndex(
  nativeMemDir: string,
  entries: { filename: string; description: string }[],
): void {
  if (entries.length === 0) return;

  const indexPath = path.join(nativeMemDir, 'MEMORY.md');
  let existing = '';
  if (fs.existsSync(indexPath)) {
    existing = fs.readFileSync(indexPath, 'utf-8');
  }

  const newLines = entries.map((e) => `- [${e.filename}](${e.filename}) — ${e.description}`);
  const separator = existing.length > 0 && !existing.endsWith('\n') ? '\n' : '';
  const content = existing + separator + newLines.join('\n') + '\n';

  fs.mkdirSync(nativeMemDir, { recursive: true });
  fs.writeFileSync(indexPath, content, 'utf-8');
}

/**
 * Migrate all v2 memories to native format.
 * Idempotent — skips projects with sentinel file.
 */
export function migrateV3(v2BaseDir: string, nativeBaseDir: string): MigrateResult {
  const result: MigrateResult = {
    projectsMigrated: 0,
    projectsSkipped: 0,
    memoriesMigrated: 0,
  };

  if (!fs.existsSync(v2BaseDir)) {
    return result;
  }

  const projects = fs
    .readdirSync(v2BaseDir, { withFileTypes: true })
    .filter((d) => d.isDirectory());

  for (const project of projects) {
    const v2ProjectDir = path.join(v2BaseDir, project.name);
    const sentinelPath = path.join(v2ProjectDir, SENTINEL);

    if (fs.existsSync(sentinelPath)) {
      result.projectsSkipped++;
      continue;
    }

    const nativeMemDir = path.join(nativeBaseDir, project.name, 'memory');
    const { migrated, entries } = migrateProject(v2ProjectDir, nativeMemDir);

    updateMemoryIndex(nativeMemDir, entries);

    // Write sentinel
    fs.writeFileSync(sentinelPath, new Date().toISOString(), 'utf-8');

    result.projectsMigrated++;
    result.memoriesMigrated += migrated;
  }

  return result;
}

/**
 * CLI entry point — uses default paths.
 */
export function runMigration(): void {
  const homeDir = os.homedir();
  const v2BaseDir = path.join(homeDir, '.eidetic', 'memories');
  const nativeBaseDir = path.join(homeDir, '.claude', 'projects');

  process.stderr.write('Eidetic v2 → v3 migration\n');
  process.stderr.write(`  v2 source: ${v2BaseDir}\n`);
  process.stderr.write(`  v3 target: ${nativeBaseDir}\n\n`);

  const result = migrateV3(v2BaseDir, nativeBaseDir);

  process.stderr.write(`Done.\n`);
  process.stderr.write(`  Projects migrated: ${result.projectsMigrated}\n`);
  process.stderr.write(`  Projects skipped:  ${result.projectsSkipped}\n`);
  process.stderr.write(`  Memories migrated: ${result.memoriesMigrated}\n`);
}
