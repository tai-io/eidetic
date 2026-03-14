import { describe, it, expect } from 'vitest';
import { parseMemoryFile, serializeMemoryFile } from '../markdown-io.js';
import type { MemoryFile } from '../markdown-io.js';

const VALID_FILE = `---
id: a1b2c3d4-e5f6-7890-abcd-ef1234567890
query: "How does auth work in this project?"
project: my-app
session_id: session-abc123
created_at: "2026-03-14T10:30:00.000Z"
---

- [convention] Auth uses JWT tokens with 24h expiry
- [decision] Chose Passport.js over custom middleware
- [fact] Auth middleware is in src/middleware/auth.ts
`;

describe('parseMemoryFile', () => {
  it('parses a valid memory file', () => {
    const result = parseMemoryFile(VALID_FILE);
    expect(result).not.toBeNull();
    expect(result!.id).toBe('a1b2c3d4-e5f6-7890-abcd-ef1234567890');
    expect(result!.query).toBe('How does auth work in this project?');
    expect(result!.project).toBe('my-app');
    expect(result!.sessionId).toBe('session-abc123');
    expect(result!.createdAt).toBe('2026-03-14T10:30:00.000Z');
    expect(result!.facts).toHaveLength(3);
    expect(result!.facts[0]).toEqual({
      kind: 'convention',
      text: 'Auth uses JWT tokens with 24h expiry',
    });
    expect(result!.facts[1]).toEqual({
      kind: 'decision',
      text: 'Chose Passport.js over custom middleware',
    });
    expect(result!.facts[2]).toEqual({
      kind: 'fact',
      text: 'Auth middleware is in src/middleware/auth.ts',
    });
  });

  it('returns null for missing frontmatter', () => {
    expect(parseMemoryFile('just some text')).toBeNull();
  });

  it('returns null for invalid YAML', () => {
    const bad = `---
: [invalid yaml
---

- [fact] something
`;
    expect(parseMemoryFile(bad)).toBeNull();
  });

  it('returns null for missing required frontmatter fields', () => {
    const missing = `---
id: a1b2c3d4-e5f6-7890-abcd-ef1234567890
query: "test"
---

- [fact] something
`;
    expect(parseMemoryFile(missing)).toBeNull();
  });

  it('returns null for invalid UUID', () => {
    const badId = `---
id: not-a-uuid
query: "test"
project: proj
session_id: s1
created_at: "2026-03-14T10:30:00.000Z"
---

- [fact] something
`;
    expect(badId).toBeTruthy(); // ensure string is not empty
    expect(parseMemoryFile(badId)).toBeNull();
  });

  it('skips lines that are not valid fact format', () => {
    const mixed = `---
id: a1b2c3d4-e5f6-7890-abcd-ef1234567890
query: "test"
project: proj
session_id: s1
created_at: "2026-03-14T10:30:00.000Z"
---

- [fact] valid fact
Some random text
- not a fact line
- [fact] another valid fact
`;
    const result = parseMemoryFile(mixed);
    expect(result).not.toBeNull();
    expect(result!.facts).toHaveLength(2);
    expect(result!.facts[0].text).toBe('valid fact');
    expect(result!.facts[1].text).toBe('another valid fact');
  });

  it('skips facts with unknown kinds', () => {
    const unknownKind = `---
id: a1b2c3d4-e5f6-7890-abcd-ef1234567890
query: "test"
project: proj
session_id: s1
created_at: "2026-03-14T10:30:00.000Z"
---

- [fact] valid
- [unknown] invalid kind
- [decision] also valid
`;
    const result = parseMemoryFile(unknownKind);
    expect(result).not.toBeNull();
    expect(result!.facts).toHaveLength(2);
  });

  it('handles empty body (no facts)', () => {
    const noFacts = `---
id: a1b2c3d4-e5f6-7890-abcd-ef1234567890
query: "test"
project: proj
session_id: s1
created_at: "2026-03-14T10:30:00.000Z"
---
`;
    const result = parseMemoryFile(noFacts);
    expect(result).not.toBeNull();
    expect(result!.facts).toHaveLength(0);
  });

  it('parses all five memory kinds', () => {
    const allKinds = `---
id: a1b2c3d4-e5f6-7890-abcd-ef1234567890
query: "test"
project: proj
session_id: s1
created_at: "2026-03-14T10:30:00.000Z"
---

- [fact] a fact
- [decision] a decision
- [convention] a convention
- [constraint] a constraint
- [intent] an intent
`;
    const result = parseMemoryFile(allKinds);
    expect(result).not.toBeNull();
    expect(result!.facts).toHaveLength(5);
    expect(result!.facts.map((f) => f.kind)).toEqual([
      'fact',
      'decision',
      'convention',
      'constraint',
      'intent',
    ]);
  });
});

describe('serializeMemoryFile', () => {
  const memory: MemoryFile = {
    id: 'a1b2c3d4-e5f6-7890-abcd-ef1234567890',
    query: 'How does auth work in this project?',
    project: 'my-app',
    sessionId: 'session-abc123',
    createdAt: '2026-03-14T10:30:00.000Z',
    facts: [
      { kind: 'convention', text: 'Auth uses JWT tokens with 24h expiry' },
      { kind: 'decision', text: 'Chose Passport.js over custom middleware' },
    ],
  };

  it('produces valid markdown with frontmatter and fact list', () => {
    const output = serializeMemoryFile(memory);
    expect(output).toContain('---');
    expect(output).toContain('id: a1b2c3d4-e5f6-7890-abcd-ef1234567890');
    expect(output).toContain('query: How does auth work in this project?');
    expect(output).toContain('project: my-app');
    expect(output).toContain('session_id: session-abc123');
    expect(output).toContain('- [convention] Auth uses JWT tokens with 24h expiry');
    expect(output).toContain('- [decision] Chose Passport.js over custom middleware');
  });

  it('roundtrips through parse and serialize', () => {
    const serialized = serializeMemoryFile(memory);
    const parsed = parseMemoryFile(serialized);
    expect(parsed).not.toBeNull();
    expect(parsed!.id).toBe(memory.id);
    expect(parsed!.query).toBe(memory.query);
    expect(parsed!.project).toBe(memory.project);
    expect(parsed!.sessionId).toBe(memory.sessionId);
    expect(parsed!.createdAt).toBe(memory.createdAt);
    expect(parsed!.facts).toEqual(memory.facts);
  });

  it('handles empty facts array', () => {
    const noFacts: MemoryFile = { ...memory, facts: [] };
    const output = serializeMemoryFile(noFacts);
    expect(output).toContain('---');
    const parsed = parseMemoryFile(output);
    expect(parsed).not.toBeNull();
    expect(parsed!.facts).toHaveLength(0);
  });

  it('includes tags when explicitly set', () => {
    const withTags: MemoryFile = {
      ...memory,
      tags: ['convention', 'decision'],
    };
    const output = serializeMemoryFile(withTags);
    expect(output).toContain('tags:');
    const parsed = parseMemoryFile(output);
    expect(parsed!.tags).toEqual(['convention', 'decision']);
  });

  it('includes aliases when explicitly set', () => {
    const withAliases: MemoryFile = {
      ...memory,
      aliases: ['How does auth work in this project?'],
    };
    const output = serializeMemoryFile(withAliases);
    expect(output).toContain('aliases:');
    const parsed = parseMemoryFile(output);
    expect(parsed!.aliases).toEqual(['How does auth work in this project?']);
  });

  it('omits tags/aliases from output when not set', () => {
    const output = serializeMemoryFile(memory);
    expect(output).not.toContain('tags:');
    expect(output).not.toContain('aliases:');
  });

  it('preserves explicit tags and aliases on roundtrip', () => {
    const withExplicit: MemoryFile = {
      ...memory,
      tags: ['custom-tag', 'another'],
      aliases: ['alt name'],
    };
    const output = serializeMemoryFile(withExplicit);
    const parsed = parseMemoryFile(output);
    expect(parsed!.tags).toEqual(['custom-tag', 'another']);
    expect(parsed!.aliases).toEqual(['alt name']);
  });

  it('parses file without tags/aliases as undefined', () => {
    // VALID_FILE at top of this file has no tags/aliases
    const parsed = parseMemoryFile(VALID_FILE);
    expect(parsed).not.toBeNull();
    expect(parsed!.tags).toBeUndefined();
    expect(parsed!.aliases).toBeUndefined();
  });
});
