# 001: Replace JSON snapshot files with SQLite

**Date:** 2026-03-02
**Status:** Accepted

## Context

Incremental indexing relies on snapshots (file path → content hash mappings) to determine which files need re-embedding. These were stored as individual JSON files at `~/.eidetic/snapshots/<collection_name>.json`.

**Problem:** If the JSON file was deleted (accidentally, by cleanup tools, or filesystem issues) while the vector DB collection still existed, `index_codebase` would treat it as a first-time index. It would re-insert all file chunks without dropping the existing collection, silently creating duplicate vectors. This degraded search quality with no visible error.

## Decision

Replace per-project JSON files with a single SQLite database (`~/.eidetic/snapshots.db`) using `better-sqlite3`.

## Rationale

- **`better-sqlite3` is already a dependency** — used by `src/memory/history.ts`, so no new dependency
- **Atomic writes** — SQLite transactions prevent partial/corrupted state from crashes
- **Single file** — harder to accidentally delete one project's snapshot in isolation
- **WAL mode** — concurrent reads don't block writes
- **Same API surface** — `loadSnapshot`, `saveSnapshot`, `deleteSnapshot`, `snapshotExists` signatures unchanged, so no consumer changes needed

## Alternatives considered

1. **Keep JSON, add collection existence check before indexing** — Would fix the symptom but not the root cause (fragile file-per-project storage)
2. **Store snapshots in the vector DB metadata** — Couples snapshot logic to vector DB provider, complicates the interface

## Consequences

- Existing JSON snapshots are auto-migrated on first DB open (non-destructive)
- `cleanupOrphanedSnapshots` now queries SQLite instead of scanning the filesystem
- Test mocks need `getSnapshotDbPath` in addition to existing path mocks
