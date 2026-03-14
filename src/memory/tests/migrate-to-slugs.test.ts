import { describe, it, expect, beforeEach } from 'vitest';
import { mkdtempSync, writeFileSync, readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { randomUUID } from 'node:crypto';

import { migrateToSlugs } from '../migrate-to-slugs.js';
import { serializeMemoryFile } from '../markdown-io.js';
import type { MemoryFile } from '../markdown-io.js';

function writeUuidMemory(dir: string, query: string): string {
  const id = randomUUID();
  const memory: MemoryFile = {
    id,
    query,
    project: 'test',
    sessionId: 's1',
    createdAt: new Date().toISOString(),
    facts: [{ kind: 'fact', text: 'A fact' }],
  };
  writeFileSync(join(dir, `${id}.md`), serializeMemoryFile(memory));
  return id;
}

describe('migrateToSlugs', () => {
  let memoriesDir: string;

  beforeEach(() => {
    memoriesDir = mkdtempSync(join(tmpdir(), 'eidetic-migrate-test-'));
  });

  it('renames UUID files to slug filenames', () => {
    writeUuidMemory(memoriesDir, 'How does auth work?');

    const result = migrateToSlugs(memoriesDir);
    expect(result).toEqual({ renamed: 1 });

    const files = readdirSync(memoriesDir);
    expect(files).toHaveLength(1);
    expect(files[0]).toBe('how-does-auth-work.md');
  });

  it('handles collisions by appending suffix', () => {
    writeUuidMemory(memoriesDir, 'How does auth work?');
    writeUuidMemory(memoriesDir, 'How does auth work?');

    const result = migrateToSlugs(memoriesDir);
    expect(result).toEqual({ renamed: 2 });

    const files = readdirSync(memoriesDir).sort();
    expect(files).toContain('how-does-auth-work.md');
    expect(files).toContain('how-does-auth-work-2.md');
  });

  it('skips unparseable files', () => {
    const id = randomUUID();
    writeFileSync(join(memoriesDir, `${id}.md`), 'not valid frontmatter');
    writeUuidMemory(memoriesDir, 'Valid query');

    const result = migrateToSlugs(memoriesDir);
    expect(result).toEqual({ renamed: 1 });

    const files = readdirSync(memoriesDir);
    // UUID file with bad content stays as-is
    expect(files).toContain(`${id}.md`);
    expect(files).toContain('valid-query.md');
  });

  it('leaves non-UUID filenames untouched', () => {
    writeFileSync(join(memoriesDir, 'already-slugged.md'), 'some content');
    writeUuidMemory(memoriesDir, 'New query');

    const result = migrateToSlugs(memoriesDir);
    expect(result).toEqual({ renamed: 1 });

    const files = readdirSync(memoriesDir);
    expect(files).toContain('already-slugged.md');
    expect(files).toContain('new-query.md');
  });

  it('is idempotent — returns null on re-run', () => {
    writeUuidMemory(memoriesDir, 'Some query');
    migrateToSlugs(memoriesDir);

    // Second run — no UUID files left
    const result = migrateToSlugs(memoriesDir);
    expect(result).toBeNull();
  });

  it('returns null for empty directory', () => {
    expect(migrateToSlugs(memoriesDir)).toBeNull();
  });

  it('preserves file content after rename', () => {
    writeUuidMemory(memoriesDir, 'Content test');
    migrateToSlugs(memoriesDir);

    const content = readFileSync(join(memoriesDir, 'content-test.md'), 'utf-8');
    expect(content).toContain('query: Content test');
    expect(content).toContain('- [fact] A fact');
  });
});
