# 003: RAPTOR Knowledge Generation

## Status

Accepted

## Context

After `index_codebase` embeds code chunks, the system has fine-grained code knowledge but no high-level understanding of architecture or patterns. Users asking "how does auth work?" get raw code chunks instead of architectural summaries.

## Decision

Add a RAPTOR-inspired pipeline that runs after indexing: cluster code chunks with K-means, LLM-summarize each cluster, and store summaries in a `_knowledge` collection. Replicate to a global `eidetic_global_concepts` collection for cross-project discovery.

### Why K-means over hierarchical clustering

K-means is simple, fast, and deterministic enough for our use case. We don't need hierarchical levels — a single clustering pass with `k = max(3, sqrt(n/2))` produces good architectural groupings for codebases up to ~10K chunks.

### Why SQLite cache for summaries

LLM calls are expensive. Cluster membership is deterministic for unchanged code, so we hash the sorted member IDs and cache summaries. Re-indexing unchanged code skips all LLM calls.

### Why replicate to global concepts

Without replication, `search_memory` without a project parameter wouldn't find knowledge summaries. Global concepts enable the UserPromptSubmit hook to inject relevant architectural context before the user even asks.

### Why non-fatal integration

RAPTOR failure should never prevent indexing from completing. The pipeline is called with try/catch in the indexer, logging warnings on failure.

### Session-end triggers

RAPTOR also runs incrementally after targeted re-indexing (Stop hook). Memory extraction runs at PreCompact/SessionEnd, using the session note as LLM input. Both are non-fatal and gated on `raptorEnabled`.

## Consequences

- Indexing takes longer (LLM calls for summarization, ~30-50s for small projects)
- Additional SQLite database (`raptor.db`) and Qdrant collections
- `search_memory` returns knowledge summaries alongside human-authored memories
- UserPromptSubmit hook adds ~1-3s latency for context injection
