#!/usr/bin/env node
/**
 * Hook entry point for PreCompact and SessionEnd events.
 *
 * PreCompact: Parses transcript, writes session note, updates index, spawns background indexer.
 * SessionEnd: Same as PreCompact (writes session note if not already captured by PreCompact).
 */

import { z } from 'zod';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseTranscript } from './transcript-parser.js';
import { writeSessionNote, formatSessionNote } from './note-writer.js';
import { updateSessionIndex, readSessionIndex } from './tier0-writer.js';
import { spawnBackgroundIndexer } from './session-indexer.js';
import { getNotesDir, getProjectId } from './utils.js';
import { extractMemoriesFromTranscript } from './memory-extractor.js';
import { spawn } from 'node:child_process';

// Resolve paths at module boundary (follows project convention)
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const INDEX_RUNNER_PATH = path.join(__dirname, 'index-runner.js');
const BUFFER_RUNNER_PATH = path.join(__dirname, '..', 'memory', 'buffer-runner.js');

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

async function main(): Promise<void> {
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
        spawnBackgroundIndexer(notesDir, INDEX_RUNNER_PATH);
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
      spawnBackgroundIndexer(notesDir, INDEX_RUNNER_PATH);

      outputSuccess({
        noteFile,
        filesModified: session.filesModified.length,
        tasksCreated: session.tasksCreated.length,
      });
    }
    // Extract and store memories from session note (non-fatal, fire-and-forget)
    if (!skippedNote) {
      void extractAndStoreMemories(session, projectId);
    }

    // Flush remaining buffer items for this session (fire-and-forget)
    void flushSessionBuffer(hookInput.session_id, projectId);
  } catch (err) {
    outputError(err instanceof Error ? err.message : String(err));
  }
}

async function extractAndStoreMemories(
  session: import('./types.js').ExtractedSession,
  projectName: string,
): Promise<void> {
  try {
    const { loadConfig } = await import('../config.js');
    const config = loadConfig();
    if (!config.raptorEnabled) return;

    const sessionNoteText = formatSessionNote(session);
    const memories = await extractMemoriesFromTranscript(sessionNoteText, config.openaiApiKey);
    if (memories.length === 0) return;

    const [{ createEmbedding }, { MemoryHistory }, { MemoryStore }, { getMemoryDbPath }] =
      await Promise.all([
        import('../embedding/factory.js'),
        import('../memory/history.js'),
        import('../memory/store.js'),
        import('../paths.js'),
      ]);

    const embedding = createEmbedding(config);
    await embedding.initialize();

    const { createVectorDB } = await import('../vectordb/factory.js');
    const vectordb = await createVectorDB(config, { skipBootstrap: true });

    const history = new MemoryHistory(getMemoryDbPath());
    const store = new MemoryStore(embedding, vectordb, history);

    const facts = memories.map((m) => ({ fact: m.content, kind: m.kind, valid_at: m.valid_at }));
    await store.addMemory(facts, 'session-extract', projectName);

    process.stderr.write(`[eidetic] Extracted ${memories.length} memories from session\n`);
  } catch (err) {
    process.stderr.write(`[eidetic] Memory extraction failed (non-fatal): ${String(err)}\n`);
  }
}

async function flushSessionBuffer(sessionId: string, project: string): Promise<void> {
  try {
    const { getBufferDbPath } = await import('../paths.js');
    const { MemoryBuffer } = await import('../memory/buffer.js');
    const buffer = new MemoryBuffer(getBufferDbPath());

    const count = buffer.count(sessionId);
    if (count === 0) return;

    // Only spawn if not already consolidating
    if (!buffer.isConsolidating(sessionId)) {
      buffer.markConsolidating(sessionId);
      try {
        const child = spawn(process.execPath, [BUFFER_RUNNER_PATH, sessionId, project], {
          detached: true,
          stdio: 'ignore',
          env: process.env,
          windowsHide: true,
        });
        child.unref();
        process.stderr.write(
          `[eidetic] Flushing ${count} buffered items for session ${sessionId}\n`,
        );
      } catch {
        buffer.clearConsolidating(sessionId);
      }
    }
  } catch (err) {
    process.stderr.write(`[eidetic] Buffer flush failed (non-fatal): ${String(err)}\n`);
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

void main();
