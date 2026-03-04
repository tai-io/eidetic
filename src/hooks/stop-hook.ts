#!/usr/bin/env node
/**
 * Stop hook entry point.
 *
 * Receives hook data via stdin when a Claude session ends.
 * Commits the session's shadow git index to refs/heads/claude/<session-id>,
 * diffs against base commit to find modified files, then spawns a
 * detached background targeted re-indexer.
 */

import { z } from 'zod';
import path from 'node:path';
import fs from 'node:fs';
import os from 'node:os';
import { execFileSync, spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const StopInputSchema = z.object({
  session_id: z.string(),
  cwd: z.string(),
  hook_event_name: z.literal('Stop'),
  stop_hook_active: z.boolean().optional(),
});

async function readStdin(): Promise<string> {
  const chunks: Buffer[] = [];
  for await (const chunk of process.stdin) {
    chunks.push(chunk);
  }
  return Buffer.concat(chunks).toString('utf-8');
}

function outputSuccess(): void {
  process.stdout.write(JSON.stringify({}));
}

function outputError(message: string): void {
  process.stderr.write(`[eidetic:stop-hook] ${message}\n`);
  process.stdout.write(JSON.stringify({}));
}

async function main(): Promise<void> {
  try {
    const input = await readStdin();
    const parseResult = StopInputSchema.safeParse(JSON.parse(input));

    if (!parseResult.success) {
      outputError(`Invalid hook input: ${parseResult.error.message}`);
      return;
    }

    const { session_id, cwd } = parseResult.data;

    // Resolve git dir
    let gitDir: string;
    try {
      gitDir = execFileSync('git', ['-C', cwd, 'rev-parse', '--git-dir'], {
        encoding: 'utf-8',
        timeout: 5000,
      }).trim();
    } catch {
      // Not a git repo — nothing to do
      outputSuccess();
      return;
    }

    if (!path.isAbsolute(gitDir)) {
      gitDir = path.resolve(cwd, gitDir);
    }

    const shadowDir = path.join(gitDir, 'claude', 'indexes', session_id);
    const shadowIndex = path.join(shadowDir, 'index');
    const baseCommitFile = path.join(shadowDir, 'base_commit');

    // No shadow index means no edits happened this session
    if (!fs.existsSync(shadowIndex)) {
      outputSuccess();
      return;
    }

    if (!fs.existsSync(baseCommitFile)) {
      // Missing base commit file — clean up and bail
      try {
        fs.rmSync(shadowDir, { recursive: true, force: true });
      } catch {}
      outputSuccess();
      return;
    }

    const baseCommit = fs.readFileSync(baseCommitFile, 'utf-8').trim();

    // Write tree from shadow index
    const treeSha = execFileSync('git', ['-C', cwd, 'write-tree'], {
      env: { ...process.env, GIT_INDEX_FILE: shadowIndex },
      encoding: 'utf-8',
      timeout: 10000,
    }).trim();

    // Create a commit object pointing to that tree
    const commitSha = execFileSync(
      'git',
      ['-C', cwd, 'commit-tree', treeSha, '-p', baseCommit, '-m', `eidetic: session ${session_id}`],
      { encoding: 'utf-8', timeout: 10000 },
    ).trim();

    // Store under refs/heads/claude/<session-id> for history
    execFileSync('git', ['-C', cwd, 'update-ref', `refs/heads/claude/${session_id}`, commitSha], {
      timeout: 5000,
    });

    // Find files that changed between base and new commit
    const diffOutput = execFileSync(
      'git',
      ['-C', cwd, 'diff-tree', '--no-commit-id', '--name-only', '-r', baseCommit, commitSha],
      { encoding: 'utf-8', timeout: 5000 },
    ).trim();

    const modifiedFiles = diffOutput
      .split('\n')
      .map((f) => f.trim())
      .filter((f) => f.length > 0);

    // Clean up shadow index directory
    try {
      fs.rmSync(shadowDir, { recursive: true, force: true });
    } catch (err) {
      process.stderr.write(`[eidetic:stop-hook] Failed to clean shadow index: ${String(err)}\n`);
    }

    if (modifiedFiles.length === 0) {
      outputSuccess();
      return;
    }

    // Write manifest for targeted runner
    const manifest = { projectPath: cwd, modifiedFiles };
    const manifestFile = path.join(os.tmpdir(), `eidetic-reindex-${session_id}.json`);
    fs.writeFileSync(manifestFile, JSON.stringify(manifest), 'utf-8');

    // Spawn detached background targeted runner
    const runnerPath = path.join(__dirname, 'targeted-runner.js');
    const child = spawn(process.execPath, [runnerPath, manifestFile], {
      detached: true,
      stdio: 'ignore',
      env: process.env,
      windowsHide: true,
    });
    child.unref();

    outputSuccess();
  } catch (err) {
    outputError(err instanceof Error ? err.message : String(err));
  }
}

void main();
