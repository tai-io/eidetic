#!/usr/bin/env node
/**
 * PostToolUse hook for ExitPlanMode.
 *
 * Captures session state (like session-end) when leaving plan mode —
 * parses transcript, writes session note, updates index.
 */

import { z } from 'zod';
import { fileURLToPath } from 'node:url';
import { parseTranscript } from '../precompact/transcript-parser.js';
import { writeSessionNote } from '../precompact/note-writer.js';
import { updateSessionIndex, readSessionIndex } from '../precompact/tier0-writer.js';
import { getNotesDir, getProjectId } from '../precompact/utils.js';
import type { PostToolUseOutput } from './hook-output.js';

const PostToolUseInputSchema = z.object({
  session_id: z.string(),
  transcript_path: z.string(),
  cwd: z.string(),
  hook_event_name: z.literal('PostToolUse'),
  tool_name: z.string(),
  tool_input: z.record(z.unknown()).optional(),
  tool_response: z.unknown().optional(),
});

export async function run(): Promise<void> {
  try {
    const input = await readStdin();

    const parseResult = PostToolUseInputSchema.safeParse(JSON.parse(input));
    if (!parseResult.success) {
      writeOutput();
      return;
    }
    const hookInput = parseResult.data;

    const projectId = getProjectId(hookInput.cwd);
    const notesDir = getNotesDir(projectId);

    // Skip capture if session already captured (by PreCompact or previous plan-mode exit)
    const existingIndex = readSessionIndex(notesDir);
    const alreadyCaptured =
      existingIndex?.sessions.some((s) => s.sessionId === hookInput.session_id) ?? false;

    if (!alreadyCaptured) {
      const session = await parseTranscript(
        hookInput.transcript_path,
        hookInput.session_id,
        projectId,
        hookInput.cwd,
        'auto',
      );

      const noteFile = writeSessionNote(notesDir, session);
      updateSessionIndex(notesDir, session, noteFile);

      process.stderr.write(
        `[eidetic] Plan mode capture: saved session note (${session.filesModified.length} files, ${session.tasksCreated.length} tasks)\n`,
      );
    } else {
      process.stderr.write(
        `[eidetic] Plan mode capture: session ${hookInput.session_id} already captured, skipping\n`,
      );
    }

    writeOutput();
  } catch (err) {
    process.stderr.write(
      `[eidetic] Plan mode capture error: ${err instanceof Error ? err.message : String(err)}\n`,
    );
    writeOutput();
  }
}

function writeOutput(): void {
  const output: PostToolUseOutput = {
    hookSpecificOutput: { hookEventName: 'PostToolUse' },
  };
  process.stdout.write(JSON.stringify(output));
}

async function readStdin(): Promise<string> {
  const chunks: Buffer[] = [];
  for await (const chunk of process.stdin) {
    chunks.push(chunk as Buffer);
  }
  return Buffer.concat(chunks).toString('utf-8');
}

// CLI router calls run() directly; self-execute when run as standalone script
if (process.argv[1] === fileURLToPath(import.meta.url)) {
  void run();
}
