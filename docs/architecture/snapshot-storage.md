# Snapshot Storage

## Overview

Snapshots track which files have been indexed and their content hashes, enabling incremental re-indexing (only changed/added files get re-embedded).

## Storage: SQLite (`snapshots.db`)

Snapshots are stored in a single SQLite database at `~/.eidetic/snapshots.db` using `better-sqlite3`.

### Schema

```sql
CREATE TABLE IF NOT EXISTS snapshots (
  collection_name TEXT PRIMARY KEY,
  data TEXT NOT NULL,           -- JSON-stringified FileSnapshot ({path: {contentHash}})
  updated_at TEXT NOT NULL      -- ISO timestamp
);
```

### Why SQLite over JSON files

Previously, each project's snapshot was a separate JSON file at `~/.eidetic/snapshots/<collection_name>.json`. This had a critical bug: if the JSON file was accidentally deleted (but the vector DB collection still existed), `index_codebase` would treat it as a first-time index, re-inserting all vectors without dropping the collection. This silently created duplicate vectors and degraded search quality.

SQLite solves this because:
- **Atomic writes** — no partial/corrupted snapshots from crashes
- **Single file** — harder to accidentally delete one project's data
- **WAL mode** — concurrent reads don't block writes

### API (`src/core/snapshot-io.ts`)

| Function | Description |
|----------|-------------|
| `loadSnapshot(rootPath)` | Returns `FileSnapshot` or `null` |
| `saveSnapshot(rootPath, snapshot)` | Upserts snapshot for path |
| `deleteSnapshot(rootPath)` | Removes snapshot by path |
| `snapshotExists(rootPath)` | Checks if snapshot exists |
| `listSnapshotCollections()` | Lists all collection names in DB |
| `deleteSnapshotByCollection(name)` | Deletes by collection name directly |
| `_resetDb()` | Closes DB connection (testing only) |

All functions use `pathToCollectionName(rootPath)` as the key. The DB connection is lazy-initialized as a module-level singleton.

### Migration

On first DB open, existing JSON files in `~/.eidetic/snapshots/` are automatically imported (`INSERT OR IGNORE`). Original JSON files are left in place (non-destructive). A stderr message logs the migration count.

## Related files

- `src/core/snapshot-io.ts` — SQLite snapshot persistence
- `src/core/sync.ts` — builds `FileSnapshot` from filesystem scan (SHA-256 content hashes)
- `src/core/indexer.ts` — consumes snapshots for incremental indexing
- `src/state/snapshot.ts` — `cleanupOrphanedSnapshots()` removes snapshots whose collections no longer exist in the vector DB
- `src/paths.ts` — `getSnapshotDbPath()` returns the DB file path
