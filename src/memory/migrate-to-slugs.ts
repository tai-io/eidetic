/**
 * Migrate UUID-named memory files to human-readable slug filenames.
 *
 * Scans a memories directory for files named `<uuid>.md`, parses their
 * frontmatter to extract the query text, then renames to `<slug>.md`.
 *
 * Idempotent — non-UUID filenames are left untouched.
 */

import { readdirSync, readFileSync, renameSync } from 'node:fs';
import path from 'node:path';

import { parseMemoryFile } from './markdown-io.js';
import { slugify, resolveSlugCollision } from './slug.js';

const UUID_FILENAME_REGEX = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\.md$/i;

export interface MigrationResult {
  renamed: number;
}

/**
 * Rename UUID-named `.md` files to slug-based names.
 * Returns null if no UUID files were found (nothing to migrate).
 */
export function migrateToSlugs(memoriesDir: string): MigrationResult | null {
  let files: string[];
  try {
    files = readdirSync(memoriesDir).filter((f) => UUID_FILENAME_REGEX.test(f));
  } catch {
    return null;
  }

  if (files.length === 0) return null;

  // Collect existing non-UUID slugs to avoid collisions
  const allFiles = readdirSync(memoriesDir).filter((f) => f.endsWith('.md'));
  const existingSlugs = new Set<string>();
  for (const f of allFiles) {
    if (!UUID_FILENAME_REGEX.test(f)) {
      existingSlugs.add(path.basename(f, '.md'));
    }
  }

  let renamed = 0;

  for (const fileName of files) {
    const filePath = path.join(memoriesDir, fileName);
    try {
      const content = readFileSync(filePath, 'utf-8');
      const parsed = parseMemoryFile(content);
      if (!parsed) continue; // Unparseable — skip

      const baseSlug = slugify(parsed.query);
      const slug = resolveSlugCollision(baseSlug, existingSlugs);
      existingSlugs.add(slug);

      const newPath = path.join(memoriesDir, `${slug}.md`);
      renameSync(filePath, newPath);
      renamed++;
    } catch {
      // Skip files that fail to read/rename
    }
  }

  return { renamed };
}
