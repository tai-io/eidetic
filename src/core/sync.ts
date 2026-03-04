import fs from 'node:fs';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { glob } from 'glob';

export type FileSnapshot = Record<string, { contentHash: string }>;

interface SyncResult {
  added: string[];
  modified: string[];
  removed: string[];
}

const DEFAULT_EXTENSIONS = new Set([
  '.ts',
  '.tsx',
  '.js',
  '.jsx',
  '.mjs',
  '.cjs',
  '.py',
  '.pyi',
  '.go',
  '.java',
  '.rs',
  '.cpp',
  '.cc',
  '.cxx',
  '.c',
  '.h',
  '.hpp',
  '.cs',
  '.scala',
  '.rb',
  '.php',
  '.swift',
  '.kt',
  '.kts',
  '.lua',
  '.sh',
  '.bash',
  '.zsh',
  '.sql',
  '.r',
  '.R',
  '.m',
  '.mm', // Objective-C
  '.dart',
  '.ex',
  '.exs', // Elixir
  '.erl',
  '.hrl', // Erlang
  '.hs', // Haskell
  '.ml',
  '.mli', // OCaml
  '.vue',
  '.svelte',
  '.astro',
  '.yaml',
  '.yml',
  '.toml',
  '.json',
  '.md',
  '.mdx',
  '.html',
  '.css',
  '.scss',
  '.less',
]);

const DEFAULT_IGNORE = [
  '**/node_modules/**',
  '**/.git/**',
  '**/dist/**',
  '**/build/**',
  '**/.next/**',
  '**/target/**',
  '**/__pycache__/**',
  '**/.venv/**',
  '**/venv/**',
  '**/vendor/**',
  '**/.cache/**',
  '**/coverage/**',
  '**/*.min.js',
  '**/*.min.css',
  '**/package-lock.json',
  '**/pnpm-lock.yaml',
  '**/yarn.lock',
];

export async function scanFiles(
  rootPath: string,
  customExtensions: string[] = [],
  customIgnore: string[] = [],
): Promise<string[]> {
  const extensions = new Set([...DEFAULT_EXTENSIONS, ...customExtensions]);
  const gitignorePatterns = readGitignore(rootPath);

  const allIgnore = [...DEFAULT_IGNORE, ...gitignorePatterns, ...customIgnore];

  const files = await glob('**/*', {
    cwd: rootPath,
    nodir: true,
    dot: false,
    ignore: allIgnore,
    absolute: false,
  });

  return files.filter((f) => extensions.has(path.extname(f).toLowerCase())).sort();
}

function hashFileContent(fullPath: string): string {
  const content = fs.readFileSync(fullPath);
  return createHash('sha256').update(content).digest('hex').slice(0, 16);
}

export function buildSnapshot(rootPath: string, relativePaths: string[]): FileSnapshot {
  const snapshot: FileSnapshot = {};
  for (const rel of relativePaths) {
    const fullPath = path.join(rootPath, rel);
    try {
      const contentHash = hashFileContent(fullPath);
      snapshot[rel] = { contentHash };
    } catch (err) {
      process.stderr.write(`Skipping "${rel}": ${String(err)}\n`);
    }
  }
  return snapshot;
}

export function diffSnapshots(previous: FileSnapshot, current: FileSnapshot): SyncResult {
  const added: string[] = [];
  const modified: string[] = [];
  const removed: string[] = [];

  for (const [rel, cur] of Object.entries(current)) {
    const prev = previous[rel];
    if (!prev) {
      added.push(rel);
    } else if (prev.contentHash !== cur.contentHash) {
      modified.push(rel);
    }
  }

  for (const rel of Object.keys(previous)) {
    if (!(rel in current)) {
      removed.push(rel);
    }
  }

  return { added, modified, removed };
}

export function parseGitignorePatterns(content: string): string[] {
  return content
    .split('\n')
    .map((line) => line.trim())
    .filter((line) => line && !line.startsWith('#') && !line.startsWith('!'))
    .map((pattern) => {
      pattern = pattern.replace(/\s+$/, '');
      if (pattern.endsWith('/')) {
        pattern = pattern.slice(0, -1);
      }
      if (pattern.startsWith('/')) return pattern.slice(1);
      if (!pattern.includes('/')) return `**/${pattern}`;
      return pattern;
    })
    .filter((p) => p.length > 0);
}

function readGitignore(rootPath: string): string[] {
  const gitignorePath = path.join(rootPath, '.gitignore');
  try {
    const content = fs.readFileSync(gitignorePath, 'utf-8');
    return parseGitignorePatterns(content);
  } catch {
    return [];
  }
}

export function extensionToLanguage(ext: string): string {
  const map: Record<string, string> = {
    '.ts': 'typescript',
    '.tsx': 'tsx',
    '.js': 'javascript',
    '.jsx': 'javascript',
    '.mjs': 'javascript',
    '.cjs': 'javascript',
    '.py': 'python',
    '.pyi': 'python',
    '.go': 'go',
    '.java': 'java',
    '.rs': 'rust',
    '.cpp': 'cpp',
    '.cc': 'cpp',
    '.cxx': 'cpp',
    '.c': 'c',
    '.h': 'cpp',
    '.hpp': 'cpp',
    '.cs': 'csharp',
    '.scala': 'scala',
    '.rb': 'ruby',
    '.php': 'php',
    '.swift': 'swift',
    '.kt': 'kotlin',
    '.kts': 'kotlin',
    '.lua': 'lua',
    '.sh': 'bash',
    '.bash': 'bash',
    '.zsh': 'bash',
    '.sql': 'sql',
    '.r': 'r',
    '.R': 'r',
    '.dart': 'dart',
    '.ex': 'elixir',
    '.exs': 'elixir',
    '.hs': 'haskell',
    '.ml': 'ocaml',
    '.vue': 'vue',
    '.svelte': 'svelte',
    '.astro': 'astro',
    '.yaml': 'yaml',
    '.yml': 'yaml',
    '.toml': 'toml',
    '.json': 'json',
    '.md': 'markdown',
    '.mdx': 'markdown',
    '.html': 'html',
    '.css': 'css',
    '.scss': 'scss',
    '.less': 'less',
  };
  return map[ext.toLowerCase()] ?? 'unknown';
}
