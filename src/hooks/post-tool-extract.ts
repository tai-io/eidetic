#!/usr/bin/env node
/**
 * PostToolUse automatic memory extraction.
 * Replaces the nudge-based memory-nudge.sh approach.
 *
 * Reads PostToolUse stdin JSON (includes tool_response), pattern-matches on outcomes,
 * and stores facts directly via MemoryStore — no Claude involvement required.
 *
 * Matches: WebFetch | Bash
 */

import { execSync, spawn } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import type { ExtractedFact } from '../memory/types.js';

const FLUSH_THRESHOLD = 8; // Matches buffer.ts — inlined to avoid pulling in better-sqlite3 at module load

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const BUFFER_RUNNER_PATH = path.join(__dirname, '..', 'memory', 'buffer-runner.js');

const MAX_RESPONSE_SIZE = 10_000; // Skip extraction for large responses (data dumps)

interface PostToolUseInput {
  session_id?: string;
  cwd?: string;
  tool_name?: string;
  tool_input?: Record<string, unknown>;
  tool_response?: unknown;
}

export async function run(): Promise<void> {
  let input: PostToolUseInput;
  try {
    const raw = await readStdin();
    input = JSON.parse(raw) as PostToolUseInput;
  } catch {
    // Can't parse stdin — exit silently
    writeOutput();
    return;
  }

  const toolName = input.tool_name ?? '';
  if (toolName !== 'WebFetch' && toolName !== 'Bash') {
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

    // Write each fact to the buffer instead of directly to the store
    for (const fact of facts) {
      buffer.add(sessionId, fact.fact, 'post-tool-extract', toolName, project);
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

function extractFacts(
  toolName: string,
  toolInput: Record<string, unknown>,
  responseStr: string,
): ExtractedFact[] {
  const facts: ExtractedFact[] = [];

  if (toolName === 'WebFetch') {
    const url = typeof toolInput.url === 'string' ? toolInput.url : '';
    facts.push(...extractWebFetchFacts(url, responseStr));
  } else if (toolName === 'Bash') {
    const command = typeof toolInput.command === 'string' ? toolInput.command : '';
    facts.push(...extractBashFacts(command, responseStr));
  }

  return facts;
}

function extractWebFetchFacts(url: string, responseStr: string): ExtractedFact[] {
  const facts: ExtractedFact[] = [];
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
    });
    return facts;
  }

  // Detect other errors
  if (/(?:error|fail|403|ENOENT|EACCES)/i.test(responseStr)) {
    const snippet = responseStr.slice(0, 150).replace(/\n/g, ' ').trim();
    facts.push({
      fact: `Fetching ${url} failed: ${snippet}`,
      kind: 'fact',
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
      });
    }
  }

  return facts;
}

function extractBashFacts(command: string, responseStr: string): ExtractedFact[] {
  const facts: ExtractedFact[] = [];
  const lower = responseStr.toLowerCase();

  const isError =
    /(?:error|fail|not.found|command not found|ENOENT|EACCES|no such file)/i.test(responseStr) ||
    lower.includes('exit code') ||
    lower.includes('permission denied');

  if (isError) {
    const snippet = responseStr.slice(0, 200).replace(/\n/g, ' ').trim();
    const shortCmd = command.slice(0, 100);
    facts.push({
      fact: `Command '${shortCmd}' failed: ${snippet}`,
      kind: 'fact',
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
    });
    return facts;
  }

  // Detect config commands (git config, npm config, etc.)
  if (/\bconfig\b/.test(command)) {
    const shortCmd = command.slice(0, 120).replace(/\n/g, ' ').trim();
    facts.push({
      fact: `Configured: ${shortCmd}`,
      kind: 'fact',
    });
  }

  return facts;
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
