# ADR-004: RAPTOR Knowledge Generation via Skill-Orchestrated Haiku Agents

## Status

Accepted

## Date

2026-03-07

## Context

RAPTOR (Recursive Abstractive Processing for Tree-Organized Retrieval) generates architectural knowledge summaries by clustering indexed code chunks and summarizing each cluster. Previously, the MCP server called OpenAI's `gpt-4o-mini` directly via `fetch()` to `/chat/completions` for summarization. This created:

1. **Unnecessary LLM dependency** — the MCP server needed direct OpenAI API access for LLM completions (separate from embeddings)
2. **Tight coupling** — summarization logic was embedded inside the indexing pipeline, making `index_codebase` slower and harder to debug
3. **Redundant memory extraction** — a separate `memory-extractor.ts` also called OpenAI for knowledge extraction, duplicating what `buffer-consolidator` already does plus graph triples

## Decision

**The MCP server no longer calls LLMs directly for summarization.** Instead:

1. **Clustering is exposed as data** via `raptor_cluster` — returns cluster contents and cache state without calling any LLM
2. **Storage is a separate tool** via `raptor_store_summaries` — accepts pre-generated summaries and handles embedding, storage, caching, and global concept replication
3. **Claude Code orchestrates summarization** — the `/index` skill spawns Haiku subagents to summarize uncached clusters, keeping LLM orchestration in the skill layer
4. **Memory extractor removed** — `buffer-consolidator` already handles knowledge extraction with graph triples, making `memory-extractor` redundant

### Data Flow

**Before:** `index_codebase` → embed → cluster → LLM summarize (OpenAI) → store summaries
**After:** `index_codebase` → embed → done. Then: `/index` skill → `raptor_cluster` → Haiku agents → `raptor_store_summaries`

### Caching

Cluster hashes (SHA-256 of sorted member IDs) determine cache validity. When `raptor_cluster` returns a cluster with a `cachedSummary`, the skill skips that cluster entirely — no LLM call needed. This makes re-indexing cheap: only new/changed clusters need summarization.

## Consequences

### Positive

- **Simpler MCP server** — no LLM client code, no API key requirements beyond embeddings
- **Flexible model choice** — skill can use any Claude model (Haiku for speed, Sonnet/Opus for quality) without server changes
- **Better observability** — cluster data is visible in tool output before summarization happens
- **Decoupled indexing** — `index_codebase` completes faster, RAPTOR is an optional follow-up step

### Negative

- **Requires skill orchestration** — RAPTOR summaries aren't generated automatically during `index_codebase`; the `/index` skill must explicitly trigger the RAPTOR step
- **Background re-indexing loses RAPTOR** — the `targeted-runner` hook no longer refreshes RAPTOR after incremental re-indexing (acceptable trade-off: summaries are cached and cluster membership rarely changes from small edits)

### Neutral

- Embedding API calls (OpenAI) remain in the MCP server — this decision only affects LLM completion calls
- `buffer-consolidator` still calls OpenAI for memory consolidation — this is a separate concern and may be migrated to skill orchestration in a future ADR
