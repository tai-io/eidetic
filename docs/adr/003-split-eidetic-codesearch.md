# ADR-003: Split claude-eidetic into eidetic (memory) and codesearch (search)

**Status:** Accepted
**Date:** 2026-03-08

## Context

claude-eidetic started as a semantic code search MCP server and evolved to include persistent memory, knowledge graph, session continuity, and RAPTOR knowledge generation. The product direction is **persistent memory for AI agents** — code search is a separate, complementary product.

The monolithic architecture creates several problems:
- Users who want only memory get tree-sitter grammars and search code they don't need
- Users who want only code search get memory/graph infrastructure they don't need
- Release cycles are coupled — a search fix requires republishing the memory system
- The codebase conflates two distinct concerns with different evolution rates

## Decision

Split into two separate repos and npm packages:

### claude-eidetic (this repo) — "Persistent memory for AI agents"
- Memory CRUD: add_memory, search_memory, list_memories, delete_memory, memory_history
- Knowledge graph: browse_graph
- RAPTOR knowledge generation: raptor_cluster, raptor_store_summaries
- Session continuity: precompact, catchup/wrapup hooks
- Fact extraction: post-tool-extract hook

### claude-codesearch (new repo) — "Semantic code search MCP server"
- Code indexing/search: index_codebase, search_code, clear_index, cleanup_vectors
- Code navigation: browse_structure, list_symbols, read_file
- Doc caching: index_document, search_documents
- Status: get_indexing_status, list_indexed
- Shadow git / re-indexing hooks

### Shared infrastructure
- Both repos own their copy of embedding/ and vectordb/ (forked, independent evolution)
- Both use `~/.eidetic/` data directory (shared filesystem, no MCP-to-MCP calls)
- Codesearch stores indexed chunks in LanceDB; eidetic reads them for RAPTOR clustering

### RAPTOR stays in eidetic
RAPTOR generates cross-project knowledge (facts, decisions, conventions) queryable via search_memory. It reads code chunks from codesearch's LanceDB collections but produces memory output — it's a memory feature.

### Global concepts → memory integration
Previously RAPTOR output was stored in a separate `eidetic_global_concepts` collection and injected via a UserPromptSubmit hook. After the split, RAPTOR summaries are stored as memories queryable via search_memory, eliminating the need for the separate collection and injection hook.

## Consequences

### Positive
- Each product has a focused, smaller dependency tree (eidetic drops tree-sitter grammars)
- Independent release cycles
- Users can install either or both
- Plugin routes hooks to the correct server
- Clearer architectural boundaries

### Negative
- Forked embedding/vectordb code may drift between repos
- Two npm packages to maintain
- Plugin complexity increases (must reference both servers)

### Risks
- RAPTOR depends on codesearch having indexed code — if codesearch isn't installed, raptor_cluster finds no chunks. Acceptable: RAPTOR is opt-in and the tools gracefully handle "no chunks" case.

## Alternatives Considered

1. **Monorepo with packages** — keeps code together but adds build complexity (turborepo/nx), still couples releases. Rejected: separate repos are simpler.
2. **Shared npm package for embedding/vectordb** — reduces duplication but creates a third package to maintain and version. Rejected: premature abstraction, the code is small (~10 files) and may diverge.
3. **MCP-to-MCP calls for RAPTOR** — eidetic calls codesearch via MCP to get chunks. Rejected: adds latency, complexity, and requires both servers to be running. Shared filesystem is simpler.
