import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';

vi.mock('node:fs');

// Import after mock declaration so vi.mock hoists correctly
import {
  detectCurrentProject,
  scanProjectMemories,
  parseMemoryIndex,
  formatGlobalIndex,
} from '../cross-project-index.js';
import type { ProjectMemoryInfo } from '../cross-project-index.js';

const mockedFs = vi.mocked(fs);

describe('cross-project-index', () => {
  const originalEnv = process.env;

  beforeEach(() => {
    process.env = { ...originalEnv };
    vi.restoreAllMocks();
  });

  afterEach(() => {
    process.env = originalEnv;
  });

  // ── detectCurrentProject ──────────────────────────────────────────

  describe('detectCurrentProject', () => {
    it('returns CLAUDE_PROJECT env var when set', () => {
      process.env.CLAUDE_PROJECT = '/workspace/my-project';
      const result = detectCurrentProject();
      expect(result).toBe('/workspace/my-project');
    });

    it('returns null when CLAUDE_PROJECT is not set', () => {
      delete process.env.CLAUDE_PROJECT;
      const result = detectCurrentProject();
      expect(result).toBeNull();
    });

    it('returns null when CLAUDE_PROJECT is empty string', () => {
      process.env.CLAUDE_PROJECT = '';
      const result = detectCurrentProject();
      expect(result).toBeNull();
    });
  });

  // ── parseMemoryIndex ──────────────────────────────────────────────

  describe('parseMemoryIndex', () => {
    it('parses link entries with descriptions', () => {
      const content = '- [feedback_langfuse.md](feedback_langfuse.md) — Langfuse v4 SDK needs legacy API';
      const entries = parseMemoryIndex(content);
      expect(entries).toEqual([
        { filename: 'feedback_langfuse.md', description: 'Langfuse v4 SDK needs legacy API' },
      ]);
    });

    it('parses link entries without descriptions', () => {
      const content = '- [notes.md](notes.md)';
      const entries = parseMemoryIndex(content);
      expect(entries).toEqual([{ filename: 'notes.md', description: null }]);
    });

    it('parses multiple entries across sections', () => {
      const content = [
        '- [project_northstar.md](project_northstar.md) — Eidetic v3 north star',
        '# Section Header',
        '- [feedback_testing.md](feedback_testing.md) — Write tests first',
        '- some inline note without a link',
        '- [user_role.md](user_role.md)',
      ].join('\n');
      const entries = parseMemoryIndex(content);
      expect(entries).toHaveLength(3);
      expect(entries[0]).toEqual({
        filename: 'project_northstar.md',
        description: 'Eidetic v3 north star',
      });
      expect(entries[1]).toEqual({
        filename: 'feedback_testing.md',
        description: 'Write tests first',
      });
      expect(entries[2]).toEqual({ filename: 'user_role.md', description: null });
    });

    it('returns empty array for empty content', () => {
      expect(parseMemoryIndex('')).toEqual([]);
    });

    it('returns empty array for content with no links', () => {
      const content = [
        '# My Notes',
        '- some inline note',
        '- another note',
      ].join('\n');
      expect(parseMemoryIndex(content)).toEqual([]);
    });

    it('handles em-dash and regular dash separators', () => {
      const content = [
        '- [a.md](a.md) — em-dash description',
        '- [b.md](b.md) - regular dash description',
      ].join('\n');
      const entries = parseMemoryIndex(content);
      expect(entries).toEqual([
        { filename: 'a.md', description: 'em-dash description' },
        { filename: 'b.md', description: 'regular dash description' },
      ]);
    });

    it('excludes MEMORY.md self-references', () => {
      const content = '- [MEMORY.md](MEMORY.md) — index file';
      expect(parseMemoryIndex(content)).toEqual([]);
    });
  });

  // ── scanProjectMemories ───────────────────────────────────────────

  describe('scanProjectMemories', () => {
    it('returns empty array when projects dir does not exist', () => {
      mockedFs.existsSync.mockReturnValue(false);
      const result = scanProjectMemories('/home/user/.claude/projects');
      expect(result).toEqual([]);
    });

    it('returns empty array when projects dir has no subdirectories', () => {
      mockedFs.existsSync.mockReturnValue(true);
      mockedFs.readdirSync.mockReturnValue([]);
      const result = scanProjectMemories('/home/user/.claude/projects');
      expect(result).toEqual([]);
    });

    it('scans project directories and parses MEMORY.md', () => {
      const projectsDir = '/home/user/.claude/projects';
      const projectDir = 'E--workspace-my-project';
      const memoryDir = path.join(projectsDir, projectDir, 'memory');
      const memoryFile = path.join(memoryDir, 'MEMORY.md');

      mockedFs.existsSync.mockImplementation((p: fs.PathLike) => {
        const s = String(p);
        if (s === projectsDir) return true;
        if (s === memoryDir) return true;
        if (s === memoryFile) return true;
        return false;
      });

      mockedFs.readdirSync.mockImplementation(((p: string) => {
        if (p === projectsDir) {
          return [
            { name: projectDir, isDirectory: () => true } as unknown as fs.Dirent,
          ];
        }
        if (p === memoryDir) {
          return [
            { name: 'MEMORY.md', isDirectory: () => false } as unknown as fs.Dirent,
            { name: 'project_notes.md', isDirectory: () => false } as unknown as fs.Dirent,
          ];
        }
        return [];
      }) as unknown as typeof fs.readdirSync);

      mockedFs.readFileSync.mockReturnValue(
        '- [project_notes.md](project_notes.md) — important notes',
      );

      const result = scanProjectMemories(projectsDir);
      expect(result).toHaveLength(1);
      expect(result[0].dirName).toBe(projectDir);
      expect(result[0].entries).toEqual([
        { filename: 'project_notes.md', description: 'important notes' },
      ]);
      expect(result[0].memoryCount).toBe(1);
    });

    it('skips projects with no memory directory', () => {
      const projectsDir = '/home/user/.claude/projects';

      mockedFs.existsSync.mockImplementation((p: fs.PathLike) => {
        if (String(p) === projectsDir) return true;
        return false; // no memory dirs exist
      });

      mockedFs.readdirSync.mockImplementation(((p: string) => {
        if (p === projectsDir) {
          return [
            { name: 'project-a', isDirectory: () => true } as unknown as fs.Dirent,
          ];
        }
        return [];
      }) as unknown as typeof fs.readdirSync);

      const result = scanProjectMemories(projectsDir);
      expect(result).toEqual([]);
    });

    it('counts md files excluding MEMORY.md for memory count', () => {
      const projectsDir = '/home/user/.claude/projects';
      const projDir = 'test-project';
      const memoryDir = path.join(projectsDir, projDir, 'memory');
      const memoryFile = path.join(memoryDir, 'MEMORY.md');

      mockedFs.existsSync.mockImplementation((p: fs.PathLike) => {
        const s = String(p);
        return s === projectsDir || s === memoryDir || s === memoryFile;
      });

      mockedFs.readdirSync.mockImplementation(((p: string) => {
        if (p === projectsDir) {
          return [{ name: projDir, isDirectory: () => true } as unknown as fs.Dirent];
        }
        if (p === memoryDir) {
          return [
            { name: 'MEMORY.md', isDirectory: () => false },
            { name: 'a.md', isDirectory: () => false },
            { name: 'b.md', isDirectory: () => false },
            { name: 'c.md', isDirectory: () => false },
          ] as unknown as fs.Dirent[];
        }
        return [];
      }) as unknown as typeof fs.readdirSync);

      mockedFs.readFileSync.mockReturnValue(
        '- [a.md](a.md) — desc a\n- [b.md](b.md) — desc b',
      );

      const result = scanProjectMemories(projectsDir);
      expect(result[0].memoryCount).toBe(3);
    });
  });

  // ── formatGlobalIndex ─────────────────────────────────────────────

  describe('formatGlobalIndex', () => {
    it('formats current project with filenames only (compact)', () => {
      const projects: ProjectMemoryInfo[] = [
        {
          dirName: 'E--workspace-tai-io-eidetic',
          entries: [
            { filename: 'project_northstar.md', description: 'Eidetic v3 north star' },
            { filename: 'feedback_testing.md', description: 'Write tests first' },
          ],
          memoryCount: 2,
        },
      ];

      const output = formatGlobalIndex('E--workspace-tai-io-eidetic', projects);
      expect(output).toContain('# Eidetic Cross-Project Memory Index');
      expect(output).toContain('## Current: eidetic (2 memories)');
      expect(output).toContain('- project_northstar.md');
      expect(output).toContain('- feedback_testing.md');
      // Descriptions should NOT appear for current project
      expect(output).not.toContain('Eidetic v3 north star');
      expect(output).not.toContain('Write tests first');
    });

    it('formats other projects with descriptions', () => {
      const projects: ProjectMemoryInfo[] = [
        {
          dirName: 'E--workspace-audrey',
          entries: [
            { filename: 'langfuse.md', description: 'Langfuse v4 API notes' },
          ],
          memoryCount: 1,
        },
      ];

      const output = formatGlobalIndex('E--workspace-other', projects);
      expect(output).toContain('## audrey (1 memory)');
      expect(output).toContain('- langfuse.md — Langfuse v4 API notes');
    });

    it('handles entries without descriptions in other projects', () => {
      const projects: ProjectMemoryInfo[] = [
        {
          dirName: 'some-project',
          entries: [{ filename: 'notes.md', description: null }],
          memoryCount: 1,
        },
      ];

      const output = formatGlobalIndex(null, projects);
      expect(output).toContain('- notes.md');
      expect(output).not.toContain('—');
    });

    it('returns empty output when no projects exist', () => {
      const output = formatGlobalIndex(null, []);
      expect(output).toBe('');
    });

    it('uses singular "memory" for count of 1', () => {
      const projects: ProjectMemoryInfo[] = [
        { dirName: 'proj', entries: [], memoryCount: 1 },
      ];
      const output = formatGlobalIndex(null, projects);
      expect(output).toContain('(1 memory)');
    });

    it('uses plural "memories" for count > 1', () => {
      const projects: ProjectMemoryInfo[] = [
        { dirName: 'proj', entries: [], memoryCount: 5 },
      ];
      const output = formatGlobalIndex(null, projects);
      expect(output).toContain('(5 memories)');
    });

    it('shows current project with no memories', () => {
      const projects: ProjectMemoryInfo[] = [
        { dirName: 'my-project', entries: [], memoryCount: 0 },
      ];
      const output = formatGlobalIndex('my-project', projects);
      expect(output).toContain('## Current: my-project (0 memories)');
    });

    it('includes footer with search hint', () => {
      const projects: ProjectMemoryInfo[] = [
        { dirName: 'proj', entries: [], memoryCount: 1 },
      ];
      const output = formatGlobalIndex(null, projects);
      expect(output).toContain('Use /search <query> to read memories from any project.');
    });
  });

  // ── Project name extraction ───────────────────────────────────────

  describe('project name extraction', () => {
    it('extracts project name from path-encoded dir name', () => {
      const projects: ProjectMemoryInfo[] = [
        { dirName: 'E--workspace-tai-io-eidetic', entries: [], memoryCount: 1 },
      ];
      const output = formatGlobalIndex(null, projects);
      expect(output).toContain('## eidetic');
    });

    it('extracts project name from simple dir name', () => {
      const projects: ProjectMemoryInfo[] = [
        { dirName: 'my-cool-project', entries: [], memoryCount: 1 },
      ];
      const output = formatGlobalIndex(null, projects);
      expect(output).toContain('## my-cool-project');
    });

    it('extracts last segment from path-like dir names', () => {
      const projects: ProjectMemoryInfo[] = [
        { dirName: 'C--Users-dev-projects-webapp', entries: [], memoryCount: 1 },
      ];
      const output = formatGlobalIndex(null, projects);
      expect(output).toContain('## webapp');
    });
  });
});
