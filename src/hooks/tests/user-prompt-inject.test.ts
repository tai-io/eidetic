import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { execSync, type ExecSyncOptionsWithStringEncoding } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

let tmpDir: string;
let repoDir: string;

beforeEach(() => {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'eidetic-hook-'));
  repoDir = path.join(tmpDir, 'repo');
  fs.mkdirSync(repoDir);
  execSync('git init', { cwd: repoDir, stdio: 'pipe' });
  execSync('git config user.email "test@test.com"', { cwd: repoDir, stdio: 'pipe' });
  execSync('git config user.name "Test"', { cwd: repoDir, stdio: 'pipe' });
  execSync('git commit --allow-empty -m "init"', { cwd: repoDir, stdio: 'pipe' });
});

afterEach(() => {
  fs.rmSync(tmpDir, { recursive: true, force: true });
});

function runHook(input: string | Record<string, unknown>): string {
  const scriptPath = path.resolve(__dirname, '../user-prompt-inject.ts');
  const tsxPath = path.resolve(__dirname, '../../../node_modules/.bin/tsx');
  const stdin = typeof input === 'string' ? input : JSON.stringify(input);
  try {
    return execSync(`"${tsxPath}" "${scriptPath}"`, {
      input: stdin,
      encoding: 'utf-8',
      cwd: repoDir,
      timeout: 10000,
      stdio: ['pipe', 'pipe', 'pipe'],
      env: { ...process.env, OPENAI_API_KEY: 'test-key' },
    } as ExecSyncOptionsWithStringEncoding);
  } catch (err: any) {
    return err.stdout ?? '';
  }
}

function parseOutput(raw: string) {
  return JSON.parse(raw.trim());
}

describe('user-prompt-inject hook', () => {
  it('outputs empty hookSpecificOutput for invalid JSON', () => {
    const output = parseOutput(runHook('not json'));
    expect(output).toHaveProperty('hookSpecificOutput');
  });

  it('outputs empty hookSpecificOutput for wrong event name', () => {
    const output = parseOutput(
      runHook({ hook_event_name: 'PostToolUse', user_prompt: 'hello', cwd: repoDir }),
    );
    expect(output.hookSpecificOutput).toEqual({});
  });

  it('outputs empty hookSpecificOutput for empty prompt', () => {
    const output = parseOutput(
      runHook({ hook_event_name: 'UserPromptSubmit', user_prompt: '', cwd: repoDir }),
    );
    expect(output.hookSpecificOutput).toEqual({});
  });

  it('outputs empty hookSpecificOutput when no global concepts collection', () => {
    const output = parseOutput(
      runHook({
        hook_event_name: 'UserPromptSubmit',
        user_prompt: 'How does auth work?',
        cwd: repoDir,
      }),
    );
    expect(output).toHaveProperty('hookSpecificOutput');
  });
});
