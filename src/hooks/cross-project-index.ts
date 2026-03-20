/**
 * Cross-project memory index builder.
 *
 * SessionStart hook that scans all Claude project memory directories
 * and outputs a global index showing what memories exist across projects.
 *
 * Current project gets compact format (filenames only).
 * Other projects include descriptions from MEMORY.md entries.
 */

import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { writeHookOutput } from './hook-output.js';

// ── Types ───────────────────────────────────────────────────────────

export interface MemoryEntry {
  filename: string;
  description: string | null;
}

export interface ProjectMemoryInfo {
  dirName: string;
  entries: MemoryEntry[];
  memoryCount: number;
}

// ── Public API ──────────────────────────────────────────────────────

/**
 * Detect current project from CLAUDE_PROJECT env var.
 */
export function detectCurrentProject(): string | null {
  const value = process.env.CLAUDE_PROJECT;
  if (!value) return null;
  return value;
}

/**
 * Parse MEMORY.md content and extract linked file entries.
 * Matches `- [filename.md](filename.md) — description` or `- [filename.md](filename.md)`.
 */
export function parseMemoryIndex(content: string): MemoryEntry[] {
  if (!content) return [];

  const entries: MemoryEntry[] = [];
  const linkPattern = /^- \[([^\]]+\.md)\]\([^)]+\)(?:\s+[—-]\s+(.+))?$/;

  for (const line of content.split('\n')) {
    const match = linkPattern.exec(line.trim());
    if (!match) continue;
    const filename = match[1];
    if (filename === 'MEMORY.md') continue;
    const description = match[2] ? match[2].trim() : null;
    entries.push({ filename, description });
  }

  return entries;
}

/**
 * Scan all project memory directories under the Claude projects dir.
 */
export function scanProjectMemories(claudeProjectsDir: string): ProjectMemoryInfo[] {
  if (!fs.existsSync(claudeProjectsDir)) return [];

  const dirents = fs.readdirSync(claudeProjectsDir, { withFileTypes: true });
  const results: ProjectMemoryInfo[] = [];

  for (const dirent of dirents) {
    if (!dirent.isDirectory()) continue;
    const info = readProjectMemory(claudeProjectsDir, dirent.name);
    if (info) results.push(info);
  }

  return results;
}

/**
 * Extract a human-readable project name from a path-encoded directory name.
 * E.g., `E--workspace-tai-io-eidetic` → `eidetic`
 */
function extractProjectName(dirName: string): string {
  // Path-encoded dirs look like `E--workspace-tai-io-eidetic`
  // The pattern: a drive letter + `--` prefix indicates path encoding
  const pathEncoded = /^[A-Za-z]--/.test(dirName);
  if (pathEncoded) {
    const segments = dirName.split('-');
    return segments[segments.length - 1];
  }
  return dirName;
}

/**
 * Format the global index output from scanned project data.
 */
export function formatGlobalIndex(
  currentProject: string | null,
  projects: ProjectMemoryInfo[],
): string {
  if (projects.length === 0) return '';

  const lines: string[] = ['# Eidetic Cross-Project Memory Index', ''];

  // Current project first, then others
  const current = currentProject ? projects.find((p) => p.dirName === currentProject) : null;
  const others = projects.filter((p) => p !== current);

  if (current) {
    lines.push(formatCurrentProject(current));
  }

  for (const proj of others) {
    lines.push(formatOtherProject(proj));
  }

  lines.push('Use /search <query> to read memories from any project.');
  return lines.join('\n');
}

/**
 * Main entry point — called by cli-router.
 */
export function run(): void {
  const claudeProjectsDir = path.join(os.homedir(), '.claude', 'projects');
  const projects = scanProjectMemories(claudeProjectsDir);
  const currentProject = detectCurrentProjectDirName(claudeProjectsDir);
  const output = formatGlobalIndex(currentProject, projects);

  if (!output) return;

  writeHookOutput({
    hookSpecificOutput: {
      hookEventName: 'SessionStart',
      additionalContext: output,
    },
  });
}

// ── Private helpers ─────────────────────────────────────────────────

function readProjectMemory(projectsDir: string, dirName: string): ProjectMemoryInfo | null {
  const memoryDir = path.join(projectsDir, dirName, 'memory');
  if (!fs.existsSync(memoryDir)) return null;

  const memoryFile = path.join(memoryDir, 'MEMORY.md');
  const entries = fs.existsSync(memoryFile)
    ? parseMemoryIndex(fs.readFileSync(memoryFile, 'utf-8'))
    : [];

  const mdFiles = fs
    .readdirSync(memoryDir, { withFileTypes: true })
    .filter((d) => !d.isDirectory() && d.name.endsWith('.md') && d.name !== 'MEMORY.md');

  return { dirName, entries, memoryCount: mdFiles.length };
}

function formatCurrentProject(proj: ProjectMemoryInfo): string {
  const name = extractProjectName(proj.dirName);
  const count = pluralizeMemory(proj.memoryCount);
  const lines = [`## Current: ${name} (${count})`];
  for (const entry of proj.entries) {
    lines.push(`- ${entry.filename}`);
  }
  lines.push('');
  return lines.join('\n');
}

function formatOtherProject(proj: ProjectMemoryInfo): string {
  const name = extractProjectName(proj.dirName);
  const count = pluralizeMemory(proj.memoryCount);
  const lines = [`## ${name} (${count})`];
  for (const entry of proj.entries) {
    if (entry.description) {
      lines.push(`- ${entry.filename} — ${entry.description}`);
    } else {
      lines.push(`- ${entry.filename}`);
    }
  }
  lines.push('');
  return lines.join('\n');
}

function pluralizeMemory(count: number): string {
  return count === 1 ? '1 memory' : `${count} memories`;
}

/**
 * Detect the current project's directory name by matching CLAUDE_PROJECT
 * against project directory names in the Claude projects dir.
 */
function detectCurrentProjectDirName(claudeProjectsDir: string): string | null {
  const project = detectCurrentProject();
  if (!project) return null;

  // The env var might be the raw path; Claude encodes paths as dir names
  // by replacing path separators with dashes and drive colon with double-dash
  if (!fs.existsSync(claudeProjectsDir)) return null;

  const dirents = fs.readdirSync(claudeProjectsDir, { withFileTypes: true });
  for (const d of dirents) {
    if (!d.isDirectory()) continue;
    // Check if the directory name is a path-encoded version of the project
    const decoded = decodeDirName(d.name);
    if (decoded === project || d.name === project) {
      return d.name;
    }
  }
  return null;
}

function decodeDirName(dirName: string): string {
  // E--workspace-tai-io-eidetic → E:/workspace/tai-io/eidetic
  // Replace leading X-- with X:/
  const decoded = dirName.replace(/^([A-Za-z])--/, '$1:/').replace(/-/g, '/');
  return decoded;
}
