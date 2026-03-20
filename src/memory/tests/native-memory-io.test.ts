import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {
  writeNativeMemory,
  updateMemoryIndex,
  readNativeMemory,
  listNativeMemories,
} from '../native-memory-io.js';

let tmpDir: string;

beforeEach(() => {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'native-mem-'));
});

afterEach(() => {
  fs.rmSync(tmpDir, { recursive: true, force: true });
});

describe('writeNativeMemory', () => {
  it('creates memory file with correct YAML frontmatter and content', () => {
    const result = writeNativeMemory(
      tmpDir,
      'auth_conventions',
      'Authentication patterns used in the project',
      'project',
      'Auth uses JWT tokens with 24h expiry.',
    );

    const content = fs.readFileSync(result.filePath, 'utf-8');
    expect(content).toContain('---');
    expect(content).toContain('name: auth_conventions');
    expect(content).toContain('description: Authentication patterns used in the project');
    expect(content).toContain('type: project');
    expect(content).toContain('Auth uses JWT tokens with 24h expiry.');
  });

  it('creates memory directory if it does not exist', () => {
    const nested = path.join(tmpDir, 'deep', 'nested', 'memory');
    const result = writeNativeMemory(nested, 'test', 'desc', 'user', 'body');

    expect(fs.existsSync(nested)).toBe(true);
    expect(fs.existsSync(result.filePath)).toBe(true);
  });

  it('uses slugified name for filename', () => {
    const result = writeNativeMemory(
      tmpDir,
      'How Does Auth Work',
      'desc',
      'user',
      'body',
    );

    expect(result.filename).toBe('how-does-auth-work.md');
  });

  it('resolves slug collisions by appending -2, -3', () => {
    const r1 = writeNativeMemory(tmpDir, 'my topic', 'desc1', 'user', 'body1');
    const r2 = writeNativeMemory(tmpDir, 'my topic', 'desc2', 'user', 'body2');
    const r3 = writeNativeMemory(tmpDir, 'my topic', 'desc3', 'user', 'body3');

    expect(r1.filename).toBe('my-topic.md');
    expect(r2.filename).toBe('my-topic-2.md');
    expect(r3.filename).toBe('my-topic-3.md');

    expect(fs.existsSync(r1.filePath)).toBe(true);
    expect(fs.existsSync(r2.filePath)).toBe(true);
    expect(fs.existsSync(r3.filePath)).toBe(true);
  });

  it('returns the actual filename and full path used', () => {
    const result = writeNativeMemory(tmpDir, 'test name', 'desc', 'reference', 'body');

    expect(result.filename).toBe('test-name.md');
    expect(result.filePath).toBe(path.join(tmpDir, 'test-name.md'));
  });
});

describe('updateMemoryIndex', () => {
  it('creates MEMORY.md if it does not exist', () => {
    updateMemoryIndex(tmpDir, 'auth.md', 'Auth conventions');

    const indexPath = path.join(tmpDir, 'MEMORY.md');
    const content = fs.readFileSync(indexPath, 'utf-8');
    expect(content).toBe('- [auth.md](auth.md) — Auth conventions\n');
  });

  it('appends entry to existing MEMORY.md', () => {
    fs.writeFileSync(
      path.join(tmpDir, 'MEMORY.md'),
      '- [existing.md](existing.md) — Existing entry\n',
    );

    updateMemoryIndex(tmpDir, 'new.md', 'New entry');

    const content = fs.readFileSync(path.join(tmpDir, 'MEMORY.md'), 'utf-8');
    expect(content).toBe(
      '- [existing.md](existing.md) — Existing entry\n- [new.md](new.md) — New entry\n',
    );
  });

  it('does not add duplicate entries (idempotent)', () => {
    updateMemoryIndex(tmpDir, 'auth.md', 'Auth conventions');
    updateMemoryIndex(tmpDir, 'auth.md', 'Auth conventions');

    const content = fs.readFileSync(path.join(tmpDir, 'MEMORY.md'), 'utf-8');
    const lines = content.split('\n').filter((l) => l.includes('auth.md'));
    expect(lines).toHaveLength(1);
  });

  it('preserves existing content and sections in MEMORY.md', () => {
    const existing = `# Memory Index

Some introduction text.

- [old.md](old.md) — Old entry
`;
    fs.writeFileSync(path.join(tmpDir, 'MEMORY.md'), existing);

    updateMemoryIndex(tmpDir, 'new.md', 'New entry');

    const content = fs.readFileSync(path.join(tmpDir, 'MEMORY.md'), 'utf-8');
    expect(content).toContain('# Memory Index');
    expect(content).toContain('Some introduction text.');
    expect(content).toContain('- [old.md](old.md) — Old entry');
    expect(content).toContain('- [new.md](new.md) — New entry');
  });
});

describe('readNativeMemory', () => {
  it('reads and parses frontmatter and content from memory file', () => {
    const fileContent = `---
name: auth_conventions
description: Auth patterns
type: project
---

Auth uses JWT tokens with 24h expiry.
`;
    fs.writeFileSync(path.join(tmpDir, 'auth.md'), fileContent);

    const result = readNativeMemory(tmpDir, 'auth.md');

    expect(result).not.toBeNull();
    expect(result).toEqual({
      name: 'auth_conventions',
      description: 'Auth patterns',
      type: 'project',
      content: 'Auth uses JWT tokens with 24h expiry.\n',
    });
  });

  it('returns null for non-existent files', () => {
    const result = readNativeMemory(tmpDir, 'nonexistent.md');
    expect(result).toBeNull();
  });
});

describe('listNativeMemories', () => {
  it('lists all .md files except MEMORY.md', () => {
    fs.writeFileSync(path.join(tmpDir, 'MEMORY.md'), '# index');
    fs.writeFileSync(path.join(tmpDir, 'auth.md'), 'auth');
    fs.writeFileSync(path.join(tmpDir, 'db.md'), 'db');
    fs.writeFileSync(path.join(tmpDir, 'notes.txt'), 'not a memory');

    const result = listNativeMemories(tmpDir);

    expect(result).toContain('auth.md');
    expect(result).toContain('db.md');
    expect(result).not.toContain('MEMORY.md');
    expect(result).not.toContain('notes.txt');
  });

  it('returns empty array for non-existent directory', () => {
    const result = listNativeMemories(path.join(tmpDir, 'nonexistent'));
    expect(result).toEqual([]);
  });
});
