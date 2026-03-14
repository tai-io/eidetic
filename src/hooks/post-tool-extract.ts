#!/usr/bin/env node
/**
 * PostToolUse automatic memory extraction.
 *
 * Reads PostToolUse stdin JSON (includes tool_response), extracts facts,
 * and buffers them for LLM-based consolidation via buffer-runner.
 *
 * Captures: Read, Edit, Write, Grep, Glob (file-context) + WebFetch, Bash (tool-output)
 */

import { execSync, spawn } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import type { ExtractedFact, BufferSource } from '../memory/types.js';

const FLUSH_THRESHOLD = 8; // Matches buffer.ts — inlined to avoid pulling in better-sqlite3 at module load

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const BUFFER_RUNNER_PATH = path.join(__dirname, '..', 'memory', 'buffer-runner.js');

const MAX_RESPONSE_SIZE = 10_000; // Skip extraction for large responses (data dumps)
const MAX_RAW_OUTPUT_SIZE = 2_000; // Truncate raw output stored in buffer for trace

/** Noise patterns to filter out of Bash output before considering it an error */
const NOISE_PATTERNS = [
  /conda:?\s*(command\s+not\s+found|not\s+initialized)/i,
  /nvm:?\s*(command\s+not\s+found|not\s+compatible)/i,
  /rbenv:?\s*command\s+not\s+found/i,
  /pyenv:?\s*command\s+not\s+found/i,
  /warning:\s*CRLF\s+will\s+be\s+replaced/i,
  /warning:\s*LF\s+will\s+be\s+replaced/i,
  /\bCRLF\b.*\bLF\b/i,
  /bash:.*:\s*command\s+not\s+found$/im,
];

interface PostToolUseInput {
  session_id?: string;
  cwd?: string;
  tool_name?: string;
  tool_input?: Record<string, unknown>;
  tool_response?: unknown;
}

export interface ExtractedToolFact extends ExtractedFact {
  source: BufferSource;
}

const SUPPORTED_TOOLS = new Set(['Read', 'Edit', 'Write', 'Grep', 'Glob', 'WebFetch', 'Bash']);

export async function run(): Promise<void> {
  let input: PostToolUseInput;
  try {
    const raw = await readStdin();
    input = JSON.parse(raw) as PostToolUseInput;
  } catch {
    writeOutput();
    return;
  }

  const toolName = input.tool_name ?? '';
  if (!SUPPORTED_TOOLS.has(toolName)) {
    writeOutput();
    return;
  }

  const responseStr = stringifyResponse(input.tool_response);

  // Skip if response is too large (likely a successful data dump, not an error)
  if (responseStr.length > MAX_RESPONSE_SIZE) {
    writeOutput();
    return;
  }

  const facts = extractFacts(toolName, input.tool_input ?? {}, responseStr);
  if (facts.length === 0) {
    writeOutput();
    return;
  }

  try {
    const cwd = input.cwd ?? process.cwd();
    const sessionId = input.session_id ?? 'unknown';
    const project = detectProject(cwd);

    const { getBufferDbPath } = await import('../paths.js');
    const { MemoryBuffer } = await import('../memory/buffer.js');
    const buffer = new MemoryBuffer(getBufferDbPath());

    const rawOutput = responseStr.slice(0, MAX_RAW_OUTPUT_SIZE);

    for (const fact of facts) {
      const filePaths = fact.files.length > 0 ? JSON.stringify(fact.files) : null;
      buffer.add(sessionId, fact.fact, fact.source, toolName, project, filePaths, rawOutput);
    }

    // Check if we should trigger consolidation
    if (buffer.count(sessionId) >= FLUSH_THRESHOLD && !buffer.isConsolidating(sessionId)) {
      buffer.markConsolidating(sessionId);
      spawnBufferRunner(sessionId, project);
    }
  } catch (err) {
    process.stderr.write(`post-tool-extract failed: ${String(err)}\n`);
  }

  writeOutput();
}

export function extractFacts(
  toolName: string,
  toolInput: Record<string, unknown>,
  responseStr: string,
): ExtractedToolFact[] {
  switch (toolName) {
    case 'Read':
      return extractReadFacts(toolInput);
    case 'Edit':
      return extractEditFacts(toolInput);
    case 'Write':
      return extractWriteFacts(toolInput);
    case 'Grep':
      return extractGrepFacts(toolInput);
    case 'Glob':
      return extractGlobFacts(toolInput);
    case 'WebFetch':
      return extractWebFetchFacts(toolInput, responseStr);
    case 'Bash':
      return extractBashFacts(toolInput, responseStr);
    default:
      return [];
  }
}

function extractReadFacts(toolInput: Record<string, unknown>): ExtractedToolFact[] {
  const filePath = typeof toolInput.file_path === 'string' ? toolInput.file_path : '';
  if (!filePath) return [];
  return [
    { fact: `Read file: ${filePath}`, kind: 'fact', files: [filePath], source: 'file-context' },
  ];
}

function extractEditFacts(toolInput: Record<string, unknown>): ExtractedToolFact[] {
  const filePath = typeof toolInput.file_path === 'string' ? toolInput.file_path : '';
  if (!filePath) return [];
  return [
    { fact: `Edited file: ${filePath}`, kind: 'fact', files: [filePath], source: 'file-context' },
  ];
}

function extractWriteFacts(toolInput: Record<string, unknown>): ExtractedToolFact[] {
  const filePath = typeof toolInput.file_path === 'string' ? toolInput.file_path : '';
  if (!filePath) return [];
  return [
    { fact: `Wrote file: ${filePath}`, kind: 'fact', files: [filePath], source: 'file-context' },
  ];
}

function extractGrepFacts(toolInput: Record<string, unknown>): ExtractedToolFact[] {
  const pattern = typeof toolInput.pattern === 'string' ? toolInput.pattern : '';
  const searchPath = typeof toolInput.path === 'string' ? toolInput.path : '';
  if (!pattern) return [];
  const files = searchPath ? [searchPath] : [];
  const suffix = searchPath ? ` in ${searchPath}` : '';
  return [
    { fact: `Searched for '${pattern}'${suffix}`, kind: 'fact', files, source: 'file-context' },
  ];
}

function extractGlobFacts(toolInput: Record<string, unknown>): ExtractedToolFact[] {
  const pattern = typeof toolInput.pattern === 'string' ? toolInput.pattern : '';
  if (!pattern) return [];
  return [
    {
      fact: `Searched for files matching '${pattern}'`,
      kind: 'fact',
      files: [],
      source: 'file-context',
    },
  ];
}

function extractWebFetchFacts(
  toolInput: Record<string, unknown>,
  responseStr: string,
): ExtractedToolFact[] {
  const url = typeof toolInput.url === 'string' ? toolInput.url : '';
  const facts: ExtractedToolFact[] = [];
  const lower = responseStr.toLowerCase();

  // Detect 404 / not found
  if (
    /\b404\b/.test(responseStr) ||
    lower.includes('page not found') ||
    lower.includes('not found')
  ) {
    if (url) {
      facts.push({
        fact: `URL ${url} returned 404 / not found`,
        kind: 'fact',
        files: [],
        source: 'tool-output',
      });
    }
    return facts;
  }

  // Detect redirect notice
  const redirectMatch = /redirected?\s+to\s+(https?:\/\/\S+)/i.exec(responseStr);
  if (redirectMatch) {
    facts.push({
      fact: `URL ${url} redirects to ${redirectMatch[1]}`,
      kind: 'fact',
      files: [],
      source: 'tool-output',
    });
    return facts;
  }

  // Detect other errors
  if (/(?:error|fail|403|ENOENT|EACCES)/i.test(responseStr)) {
    const snippet = responseStr.slice(0, 150).replace(/\n/g, ' ').trim();
    facts.push({
      fact: `Fetching ${url} failed: ${snippet}`,
      kind: 'fact',
      files: [],
      source: 'tool-output',
    });
    return facts;
  }

  // Successful fetch — extract URL + key finding (first 200 chars)
  if (url) {
    const snippet = responseStr.slice(0, 200).replace(/\n/g, ' ').trim();
    if (snippet.length > 20) {
      facts.push({
        fact: `Docs at ${url}: ${snippet}`,
        kind: 'fact',
        files: [],
        source: 'tool-output',
      });
    }
  }

  return facts;
}

function extractBashFacts(
  toolInput: Record<string, unknown>,
  responseStr: string,
): ExtractedToolFact[] {
  const command = typeof toolInput.command === 'string' ? toolInput.command : '';
  const facts: ExtractedToolFact[] = [];

  // Strip noisy shell environment lines before analyzing
  const cleanedResponse = stripNoiseLines(responseStr);

  // If everything was noise, skip
  if (cleanedResponse.trim().length === 0) return facts;

  const isError =
    /(?:error|fail|not.found|command not found|ENOENT|EACCES|no such file)/i.test(
      cleanedResponse,
    ) ||
    cleanedResponse.toLowerCase().includes('exit code') ||
    cleanedResponse.toLowerCase().includes('permission denied');

  if (isError) {
    const snippet = cleanedResponse.slice(0, 200).replace(/\n/g, ' ').trim();
    const shortCmd = command.slice(0, 100);
    // Extract file paths from command
    const files = extractFilePathsFromCommand(command);
    facts.push({
      fact: `Command '${shortCmd}' failed: ${snippet}`,
      kind: 'fact',
      files,
      source: 'tool-output',
    });
    return facts;
  }

  // Detect successful installs
  const installMatch =
    /(?:npm|yarn|pnpm|pip|pip3|brew|apt|apt-get|cargo)\s+(?:install|add|i)\s+(.+)/.exec(command);
  if (installMatch) {
    const pkg = installMatch[1].trim().slice(0, 80);
    const manager = command.split(' ')[0];
    facts.push({
      fact: `Installed ${pkg} via ${manager}`,
      kind: 'fact',
      files: [],
      source: 'tool-output',
    });
    return facts;
  }

  // Detect config commands (git config, npm config, etc.)
  if (/\bconfig\b/.test(command)) {
    const shortCmd = command.slice(0, 120).replace(/\n/g, ' ').trim();
    facts.push({ fact: `Configured: ${shortCmd}`, kind: 'fact', files: [], source: 'tool-output' });
  }

  return facts;
}

function stripNoiseLines(responseStr: string): string {
  return responseStr
    .split('\n')
    .filter((line) => !NOISE_PATTERNS.some((p) => p.test(line)))
    .join('\n');
}

function extractFilePathsFromCommand(command: string): string[] {
  // Simple heuristic: find things that look like file paths
  const pathRegex = /(?:^|\s)((?:\/|\.\/|\.\.\/)[^\s;|&>]+)/g;
  const paths: string[] = [];
  let match: RegExpExecArray | null;
  while ((match = pathRegex.exec(command)) !== null) {
    paths.push(match[1]);
  }
  return paths;
}

function detectProject(cwd: string): string {
  try {
    const result = execSync('git rev-parse --show-toplevel', {
      cwd,
      encoding: 'utf-8',
      stdio: ['pipe', 'pipe', 'pipe'],
    });
    return path.basename(result.trim());
  } catch {
    return 'global';
  }
}

function stringifyResponse(response: unknown): string {
  if (typeof response === 'string') return response;
  if (response === null || response === undefined) return '';
  try {
    return JSON.stringify(response);
  } catch {
    // eslint-disable-next-line @typescript-eslint/no-base-to-string
    return String(response); // Last resort after JSON.stringify fails
  }
}

function readStdin(): Promise<string> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    process.stdin.on('data', (chunk: Buffer) => chunks.push(chunk));
    process.stdin.on('end', () => {
      resolve(Buffer.concat(chunks).toString('utf-8'));
    });
    process.stdin.on('error', reject);
  });
}

function spawnBufferRunner(sessionId: string, project: string): void {
  try {
    const child = spawn(process.execPath, [BUFFER_RUNNER_PATH, sessionId, project], {
      detached: true,
      stdio: 'ignore',
      env: process.env,
      windowsHide: true,
    });
    child.unref();
  } catch {
    // Best effort — buffer items remain for next attempt
  }
}

function writeOutput(): void {
  const output: import('./hook-output.js').PostToolUseOutput = {
    hookSpecificOutput: { hookEventName: 'PostToolUse' },
  };
  process.stdout.write(JSON.stringify(output));
}

// CLI router calls run() directly; self-execute when run as standalone script
if (process.argv[1] === fileURLToPath(import.meta.url)) {
  void run();
}
