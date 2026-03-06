# ADR-001: ChromaDB as Default Vector Database Provider

## Status

Accepted

## Date

2026-03-06

## Context

New users must have Docker installed (or a running Qdrant instance) to use Eidetic. The error "Qdrant not reachable and Docker not found" blocks first-run entirely. This is the single biggest onboarding friction point.

ChromaDB runs in-process with persistent local storage via SQLite + HNSW, eliminating the Docker requirement entirely.

## Decision

Make ChromaDB the default vector database provider (`VECTORDB_PROVIDER=chroma`). Qdrant and Milvus remain available as opt-in providers for power users.

### Changes

1. **New default**: `vectordbProvider` defaults to `'chroma'` instead of `'qdrant'`
2. **New config**: `chromaDataDir` (env: `CHROMA_DATA_DIR`) defaults to `~/.eidetic/chroma/`
3. **Dependency changes**: `chromadb` added to `dependencies`; `@qdrant/js-client-rest` moved to `optionalDependencies`
4. **Centralized factory**: `src/vectordb/factory.ts` replaces 6 duplicated provider-selection blocks
5. **Shared RRF utilities**: `src/vectordb/rrf.ts` extracted from `qdrant.ts` for reuse by ChromaDB

### Hybrid search parity

ChromaDB's hybrid search mirrors Qdrant's approach:
- Dense: `collection.query({ queryEmbeddings })` for vector similarity
- Text: `collection.get({ whereDocument: { $contains } })` for keyword matching
- Fusion: shared `reciprocalRankFusion()` blends both result sets

Chroma's `$contains` is substring match (not tokenized BM25), but Qdrant's text search is also simple keyword match — parity is acceptable.

## Consequences

### Positive

- **Zero-config onboarding**: No Docker, no external services — works out of the box
- **Faster startup**: No Docker provisioning or health-check wait
- **Simpler deployment**: Single process, data stored locally in `~/.eidetic/chroma/`
- **Reduced factory duplication**: 6 inline blocks → 1 centralized factory

### Negative

- **In-process memory**: ChromaDB uses more RAM for very large codebases vs. external Qdrant
- **No native BM25**: Text search uses substring matching (same limitation as Qdrant's approach)
- **Migration**: Users switching providers must re-index (incremental, fast)

### Neutral

- **Existing Qdrant users**: Set `VECTORDB_PROVIDER=qdrant` — everything works unchanged
- **Milvus users**: Unaffected — still opt-in via `VECTORDB_PROVIDER=milvus`
