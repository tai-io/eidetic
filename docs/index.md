# Documentation Index

## Architecture

Detailed technical documentation for system components and their design.

| Document | Description |
|----------|-------------|
| [architecture/snapshot-storage.md](architecture/snapshot-storage.md) | Snapshot persistence layer — SQLite schema, API, migration from JSON |
| [architecture/memory-system.md](architecture/memory-system.md) | Memory system — per-project collections, kind-based weighting, supersession |
| [architecture/knowledge-layer.md](architecture/knowledge-layer.md) | Knowledge layer — RAPTOR clustering, LLM summaries, global concepts, prompt injection |

## Decisions

Design decision records explaining why specific approaches were chosen.

| Decision | Description |
|----------|-------------|
| [decisions/001-sqlite-snapshots.md](decisions/001-sqlite-snapshots.md) | Replace JSON snapshot files with SQLite to prevent duplicate vectors |
| [decisions/002-memory-kind-field.md](decisions/002-memory-kind-field.md) | Replace category with kind field for query-classified weighting |
| [decisions/003-raptor-knowledge-generation.md](decisions/003-raptor-knowledge-generation.md) | RAPTOR knowledge generation — why K-means, caching, global replication |

## Reference

| Document | Description |
|----------|-------------|
| [CLAUDE.md](CLAUDE.md) | Project conventions, build commands, and architecture overview |
