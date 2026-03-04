# Memory System Architecture

## Overview

The memory system stores human-originated developer knowledge (facts, decisions, conventions, constraints, intents) in per-project Qdrant collections with semantic search, query-classified weighting, and supersession tracking.

## Collections

| Collection | Purpose |
|------------|---------|
| `eidetic_global_memory` | Cross-project memories (project="global") |
| `eidetic_<project>_memory` | Project-scoped memories |

Each memory has a `kind` field: `fact`, `decision`, `convention`, `constraint`, or `intent`.

## Data Model

### MemoryItem fields

| Field | Type | Description |
|-------|------|-------------|
| `id` | string | UUID |
| `memory` | string | Memory text (embedded) |
| `hash` | string | MD5 for dedup |
| `kind` | MemoryKind | fact / decision / convention / constraint / intent |
| `source` | string | Origin identifier |
| `project` | string | Project name or "global" |
| `access_count` | number | Explicit search hit count |
| `last_accessed` | string | ISO timestamp |
| `supersedes` | string \| null | ID of memory this replaces |
| `superseded_by` | string \| null | ID of memory that replaced this |
| `valid_at` | string | When the fact was true |
| `created_at` | string | When stored |
| `updated_at` | string | Last modified |

## Search Flow

1. Embed query text
2. Classify query → profile (feasibility / rationale / procedural)
3. Search project + global memory collections in parallel
4. Search `eidetic_global_concepts` (knowledge layer, 0.8x weight) — see [knowledge-layer.md](knowledge-layer.md)
5. Filter out superseded entries (`superseded_by IS NOT NULL`)
6. Apply kind-weighted scoring based on profile
7. Apply recency decay based on `valid_at` and kind-specific decay rates
8. Project boost (1.5x for project-matching memories)
9. Sort by final score, return top N
10. Bump `access_count` for top 5 results (fire-and-forget)

## Query Classification

| Profile | Trigger patterns | Top-weighted kind |
|---------|-----------------|-------------------|
| procedural | "how to", "how should", default | convention |
| feasibility | "can I", "should I", "allowed to" | constraint |
| rationale | "why did", "reason for", "how come" | decision |

## Reconciliation

When adding a memory, cosine similarity against existing memories determines the action:

| Cosine range | Action |
|-------------|--------|
| ≥ 0.92 | UPDATE in place (near-duplicate) |
| 0.7–0.92, same kind | SUPERSEDE (new entry, old marked superseded) |
| < 0.7 | ADD (new entry) |
| Exact hash match | NONE (skip) |

## Recency Decay

Time decay multiplier: `score * (1 / (1 + days * rate))`

| Kind | Decay rate | Rationale |
|------|-----------|-----------|
| constraint | 0.001 | Hard limits rarely change |
| decision | 0.005 | Decisions are fairly stable |
| convention | 0.005 | Patterns evolve slowly |
| fact | 0.01 | Facts go stale |
| intent | 0.05 | Plans go stale fast |

## Migration

`migrateMemories()` in `src/memory/migration.ts` reads the old `eidetic_memory` collection and writes to per-project collections with `kind: "fact"` and `source: "migrated:<original_category>"`.

## Key Files

- `src/memory/types.ts` — MemoryItem, ExtractedFact, MemoryKind types
- `src/memory/store.ts` — MemoryStore class (add/search/list/delete)
- `src/memory/reconciler.ts` — Hash + cosine dedup + supersession
- `src/memory/query-classifier.ts` — Query classification + weighting profiles
- `src/memory/history.ts` — SQLite audit log
- `src/memory/migration.ts` — Legacy collection migration
