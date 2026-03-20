#!/usr/bin/env node
/**
 * Hook entry point for PreCompact and SessionEnd events.
 *
 * PreCompact: Parses transcript, writes session note, updates index, spawns background indexer.
 * SessionEnd: Same as PreCompact (writes session note if not already captured by PreCompact).
 */

import { z } from 'zod';
import { fileURLToPath } from 'node:url';
import { parseTranscript } from './transcript-parser.js';
import { writeSessionNote } from './note-writer.js';
import { updateSessionIndex, readSessionIndex } from './tier0-writer.js';
import { getNotesDir, getProjectId } from './utils.js';

// Zod schema — handles both PreCompact and SessionEnd hook events
const HookInputSchema = z.discriminatedUnion('hook_event_name', [
  z.object({
    session_id: z.string(),
    transcript_path: z.string(),
    cwd: z.string(),
    trigger: z.enum(['auto', 'manual']),
    hook_event_name: z.literal('PreCompact'),
  }),
  z.object({
    session_id: z.string(),
    transcript_path: z.string(),
    cwd: z.string(),
    hook_event_name: z.literal('SessionEnd'),
    reason: z.string().optional(),
  }),
]);

export async function run(): Promise<void> {
  try {
    const input = await readStdin();

    const parseResult = HookInputSchema.safeParse(JSON.parse(input));
    if (!parseResult.success) {
      outputError(`Invalid hook input: ${parseResult.error.message}`);
      return;
    }
    const hookInput = parseResult.data;

    const projectId = getProjectId(hookInput.cwd);
    const notesDir = getNotesDir(projectId);
    const trigger = hookInput.hook_event_name === 'PreCompact' ? hookInput.trigger : 'session_end';

    // Parse transcript
    const session = await parseTranscript(
      hookInput.transcript_path,
      hookInput.session_id,
      projectId,
      hookInput.cwd,
      trigger,
    );

    let noteFile: string;
    let skippedNote = false;

    if (hookInput.hook_event_name === 'SessionEnd') {
      // Dedup check: skip note if already captured by PreCompact
      const existingIndex = readSessionIndex(notesDir);
      const alreadyCaptured =
        existingIndex?.sessions.some((s) => s.sessionId === hookInput.session_id) ?? false;

      if (alreadyCaptured) {
        skippedNote = true;
        // Use placeholder path — note already exists
        // existingIndex is non-null here: alreadyCaptured implies existingIndex?.sessions.some() returned true
        const sessions = existingIndex?.sessions ?? [];
        const existing = sessions.find((s) => s.sessionId === hookInput.session_id);
        noteFile = existing?.noteFile ?? writeSessionNote(notesDir, session);
        process.stderr.write(
          `[eidetic] SessionEnd: session ${hookInput.session_id} already captured by PreCompact, skipping note\n`,
        );
      } else {
        noteFile = writeSessionNote(notesDir, session);
        updateSessionIndex(notesDir, session, noteFile);
      }

      outputSuccess({
        noteFile,
        skippedNote,
        filesModified: session.filesModified.length,
        tasksCreated: session.tasksCreated.length,
      });
    } else {
      // PreCompact: original flow
      noteFile = writeSessionNote(notesDir, session);
      updateSessionIndex(notesDir, session, noteFile);

      outputSuccess({
        noteFile,
        filesModified: session.filesModified.length,
        tasksCreated: session.tasksCreated.length,
      });
    }
  } catch (err) {
    outputError(err instanceof Error ? err.message : String(err));
  }
}

async function readStdin(): Promise<string> {
  const chunks: Buffer[] = [];
  for await (const chunk of process.stdin) {
    chunks.push(chunk as Buffer);
  }
  return Buffer.concat(chunks).toString('utf-8');
}

function outputSuccess(result: Record<string, unknown>): void {
  // SessionEnd/PreCompact have no hookSpecificOutput schema — log details to stderr only
  process.stderr.write(`[eidetic] ${JSON.stringify(result)}\n`);
  const output: import('../hooks/hook-output.js').SimpleHookOutput = {};
  process.stdout.write(JSON.stringify(output));
}

function outputError(message: string): void {
  process.stderr.write(`[eidetic] Error: ${message}\n`);
  const output: import('../hooks/hook-output.js').SimpleHookOutput = {};
  process.stdout.write(JSON.stringify(output));
}

// CLI router calls run() directly; self-execute when run as standalone script
if (process.argv[1] === fileURLToPath(import.meta.url)) {
  void run();
}
