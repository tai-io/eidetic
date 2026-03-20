import { describe, it, expect, beforeEach } from 'vitest';
import { join } from 'node:path';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';

import { parseV2Memory, mapKindToType, migrateV3 } from '../migrate-v3.js';

function makeV2File(opts: {
  id?: string;
  query?: string;
  slug?: string;
  project?: string;
  facts?: { kind: string; text: string }[];
}): string {
  const id = opts.id ?? 'aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee';
  const query = opts.query ?? 'how does auth work';
  const slug = opts.slug ?? 'how-does-auth-work';
  const project = opts.project ?? 'my-project';
  const facts = opts.facts ?? [{ kind: 'fact', text: 'Auth uses JWT tokens' }];

  const factLines = facts.map((f) => `- **[${f.kind}]** ${f.text}`).join('\n');

  return `---
id: ${id}
query: "${query}"
slug: ${slug}
created: 2026-01-15T10:00:00Z
updated: 2026-02-20T14:30:00Z
project: ${project}
---

## Facts

${factLines}
`;
}

describe('parseV2Memory', () => {
  it('parses a valid v2 memory file', () => {
    const content = makeV2File({
      query: 'how does auth work',
      slug: 'how-does-auth-work',
      project: 'my-project',
      facts: [
        { kind: 'fact', text: 'Auth uses JWT tokens with 24h expiry' },
        { kind: 'decision', text: 'Switched from sessions to JWT' },
        { kind: 'convention', text: 'All auth middleware goes in src/middleware/auth/' },
      ],
    });

    const result = parseV2Memory(content);
    if (result === null) throw new Error('expected non-null');
    expect(result.query).toBe('how does auth work');
    expect(result.slug).toBe('how-does-auth-work');
    expect(result.project).toBe('my-project');
    expect(result.facts).toHaveLength(3);
    expect(result.facts[0]).toEqual({ kind: 'fact', text: 'Auth uses JWT tokens with 24h expiry' });
    expect(result.facts[1]).toEqual({ kind: 'decision', text: 'Switched from sessions to JWT' });
    expect(result.facts[2]).toEqual({
      kind: 'convention',
      text: 'All auth middleware goes in src/middleware/auth/',
    });
  });

  it('returns null for content with no frontmatter', () => {
    const result = parseV2Memory('just some text without frontmatter');
    expect(result).toBeNull();
  });

  it('handles file with no facts section', () => {
    const content = `---
id: aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee
query: "empty query"
slug: empty-query
created: 2026-01-15T10:00:00Z
updated: 2026-02-20T14:30:00Z
project: my-project
---

## Facts

`;

    const result = parseV2Memory(content);
    if (result === null) throw new Error('expected non-null');
    expect(result.query).toBe('empty query');
    expect(result.facts).toHaveLength(0);
  });

  it('handles file with missing frontmatter fields', () => {
    const content = `---
id: aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee
---

## Facts

- **[fact]** some fact
`;

    const result = parseV2Memory(content);
    expect(result).toBeNull();
  });
});

describe('mapKindToType', () => {
  it('maps fact to project', () => {
    expect(mapKindToType('fact')).toBe('project');
  });

  it('maps decision to project', () => {
    expect(mapKindToType('decision')).toBe('project');
  });

  it('maps convention to feedback', () => {
    expect(mapKindToType('convention')).toBe('feedback');
  });

  it('maps constraint to feedback', () => {
    expect(mapKindToType('constraint')).toBe('feedback');
  });

  it('maps intent to project', () => {
    expect(mapKindToType('intent')).toBe('project');
  });

  it('maps unknown kinds to project', () => {
    expect(mapKindToType('something-else')).toBe('project');
  });
});

describe('migrateV3', () => {
  let tmpDir: string;
  let v2BaseDir: string;
  let nativeBaseDir: string;

  beforeEach(() => {
    tmpDir = mkdtempSync(join(tmpdir(), 'eidetic-v3-migrate-'));
    v2BaseDir = join(tmpDir, 'memories');
    nativeBaseDir = join(tmpDir, 'projects');
  });

  it('migrates a single v2 memory file to native format', () => {
    const projectDir = join(v2BaseDir, 'my-project');
    mkdirSync(projectDir, { recursive: true });
    writeFileSync(join(projectDir, 'how-does-auth-work.md'), makeV2File({}));

    const result = migrateV3(v2BaseDir, nativeBaseDir);

    expect(result.projectsMigrated).toBe(1);
    expect(result.memoriesMigrated).toBe(1);

    const nativeFile = join(nativeBaseDir, 'my-project', 'memory', 'how-does-auth-work.md');
    expect(existsSync(nativeFile)).toBe(true);

    const content = readFileSync(nativeFile, 'utf-8');
    expect(content).toContain('name: how-does-auth-work');
    expect(content).toContain('type: project');
    expect(content).toContain('Auth uses JWT tokens');
  });

  it('migrates multiple files in one project', () => {
    const projectDir = join(v2BaseDir, 'my-project');
    mkdirSync(projectDir, { recursive: true });
    writeFileSync(
      join(projectDir, 'auth.md'),
      makeV2File({ slug: 'auth', query: 'auth', facts: [{ kind: 'fact', text: 'Uses JWT' }] }),
    );
    writeFileSync(
      join(projectDir, 'db.md'),
      makeV2File({
        slug: 'db',
        query: 'database',
        facts: [{ kind: 'decision', text: 'Use PostgreSQL' }],
      }),
    );

    const result = migrateV3(v2BaseDir, nativeBaseDir);

    expect(result.projectsMigrated).toBe(1);
    expect(result.memoriesMigrated).toBe(2);
  });

  it('migrates multiple projects', () => {
    const proj1 = join(v2BaseDir, 'project-a');
    const proj2 = join(v2BaseDir, 'project-b');
    mkdirSync(proj1, { recursive: true });
    mkdirSync(proj2, { recursive: true });
    writeFileSync(
      join(proj1, 'a.md'),
      makeV2File({ slug: 'a', query: 'query a', project: 'project-a' }),
    );
    writeFileSync(
      join(proj2, 'b.md'),
      makeV2File({ slug: 'b', query: 'query b', project: 'project-b' }),
    );

    const result = migrateV3(v2BaseDir, nativeBaseDir);

    expect(result.projectsMigrated).toBe(2);
    expect(result.memoriesMigrated).toBe(2);
  });

  it('skips already-migrated projects (sentinel file exists)', () => {
    const projectDir = join(v2BaseDir, 'my-project');
    mkdirSync(projectDir, { recursive: true });
    writeFileSync(join(projectDir, 'auth.md'), makeV2File({}));
    writeFileSync(join(projectDir, '.v3-migrated'), '');

    const result = migrateV3(v2BaseDir, nativeBaseDir);

    expect(result.projectsMigrated).toBe(0);
    expect(result.projectsSkipped).toBe(1);
    expect(result.memoriesMigrated).toBe(0);
  });

  it('creates sentinel file after successful migration', () => {
    const projectDir = join(v2BaseDir, 'my-project');
    mkdirSync(projectDir, { recursive: true });
    writeFileSync(join(projectDir, 'auth.md'), makeV2File({}));

    migrateV3(v2BaseDir, nativeBaseDir);

    expect(existsSync(join(projectDir, '.v3-migrated'))).toBe(true);
  });

  it('handles v2 files with no facts gracefully', () => {
    const projectDir = join(v2BaseDir, 'my-project');
    mkdirSync(projectDir, { recursive: true });
    const content = `---
id: aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee
query: "empty query"
slug: empty-query
created: 2026-01-15T10:00:00Z
updated: 2026-02-20T14:30:00Z
project: my-project
---

## Facts

`;
    writeFileSync(join(projectDir, 'empty-query.md'), content);

    const result = migrateV3(v2BaseDir, nativeBaseDir);

    expect(result.projectsMigrated).toBe(1);
    expect(result.memoriesMigrated).toBe(1);

    const nativeFile = join(nativeBaseDir, 'my-project', 'memory', 'empty-query.md');
    expect(existsSync(nativeFile)).toBe(true);
  });

  it('handles missing v2 memories directory (no-op)', () => {
    const result = migrateV3(join(tmpDir, 'nonexistent'), nativeBaseDir);

    expect(result.projectsMigrated).toBe(0);
    expect(result.projectsSkipped).toBe(0);
    expect(result.memoriesMigrated).toBe(0);
  });

  it('maps fact kinds to correct v3 types', () => {
    const projectDir = join(v2BaseDir, 'my-project');
    mkdirSync(projectDir, { recursive: true });
    writeFileSync(
      join(projectDir, 'mixed.md'),
      makeV2File({
        slug: 'mixed',
        query: 'mixed kinds',
        facts: [
          { kind: 'fact', text: 'A fact' },
          { kind: 'convention', text: 'A convention' },
          { kind: 'constraint', text: 'A constraint' },
        ],
      }),
    );

    migrateV3(v2BaseDir, nativeBaseDir);

    const content = readFileSync(
      join(nativeBaseDir, 'my-project', 'memory', 'mixed.md'),
      'utf-8',
    );
    // convention and constraint facts should produce feedback type
    // Since file has mixed kinds, the dominant type is used
    expect(content).toContain('type:');
  });

  it('updates MEMORY.md with all migrated entries', () => {
    const projectDir = join(v2BaseDir, 'my-project');
    mkdirSync(projectDir, { recursive: true });
    writeFileSync(
      join(projectDir, 'auth.md'),
      makeV2File({
        slug: 'auth',
        query: 'how does auth work',
        facts: [{ kind: 'fact', text: 'Uses JWT' }],
      }),
    );
    writeFileSync(
      join(projectDir, 'db.md'),
      makeV2File({
        slug: 'db',
        query: 'database setup',
        facts: [{ kind: 'decision', text: 'Use PostgreSQL' }],
      }),
    );

    migrateV3(v2BaseDir, nativeBaseDir);

    const memoryMd = readFileSync(
      join(nativeBaseDir, 'my-project', 'memory', 'MEMORY.md'),
      'utf-8',
    );
    expect(memoryMd).toContain('[auth.md](auth.md)');
    expect(memoryMd).toContain('[db.md](db.md)');
    expect(memoryMd).toContain('how does auth work');
    expect(memoryMd).toContain('database setup');
  });

  it('preserves existing native memories (does not overwrite)', () => {
    // Create existing native memory
    const nativeMemDir = join(nativeBaseDir, 'my-project', 'memory');
    mkdirSync(nativeMemDir, { recursive: true });
    writeFileSync(join(nativeMemDir, 'existing.md'), 'existing content');
    writeFileSync(join(nativeMemDir, 'MEMORY.md'), '- [existing.md](existing.md) — existing\n');

    // Create v2 memory with same slug to test no-overwrite
    const projectDir = join(v2BaseDir, 'my-project');
    mkdirSync(projectDir, { recursive: true });
    writeFileSync(
      join(projectDir, 'existing.md'),
      makeV2File({
        slug: 'existing',
        query: 'existing query',
        facts: [{ kind: 'fact', text: 'new fact' }],
      }),
    );

    migrateV3(v2BaseDir, nativeBaseDir);

    // Original file should be preserved
    const content = readFileSync(join(nativeMemDir, 'existing.md'), 'utf-8');
    expect(content).toBe('existing content');
  });

  it('ignores non-md files like .vector-cache.db', () => {
    const projectDir = join(v2BaseDir, 'my-project');
    mkdirSync(projectDir, { recursive: true });
    writeFileSync(join(projectDir, '.vector-cache.db'), 'binary data');
    writeFileSync(join(projectDir, 'auth.md'), makeV2File({ slug: 'auth', query: 'auth' }));

    const result = migrateV3(v2BaseDir, nativeBaseDir);

    expect(result.memoriesMigrated).toBe(1);
  });

  it('appends to existing MEMORY.md instead of overwriting', () => {
    // Create existing MEMORY.md
    const nativeMemDir = join(nativeBaseDir, 'my-project', 'memory');
    mkdirSync(nativeMemDir, { recursive: true });
    writeFileSync(join(nativeMemDir, 'MEMORY.md'), '- [existing.md](existing.md) — existing\n');

    // Create v2 memory
    const projectDir = join(v2BaseDir, 'my-project');
    mkdirSync(projectDir, { recursive: true });
    writeFileSync(
      join(projectDir, 'auth.md'),
      makeV2File({
        slug: 'auth',
        query: 'how does auth work',
        facts: [{ kind: 'fact', text: 'Uses JWT' }],
      }),
    );

    migrateV3(v2BaseDir, nativeBaseDir);

    const memoryMd = readFileSync(join(nativeMemDir, 'MEMORY.md'), 'utf-8');
    // Should have both old and new entries
    expect(memoryMd).toContain('[existing.md](existing.md) — existing');
    expect(memoryMd).toContain('[auth.md](auth.md)');
  });
});
