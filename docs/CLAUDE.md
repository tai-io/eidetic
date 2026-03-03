# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Build & Run

```bash
npm install          # install deps (tree-sitter has native bindings)
npx tsc              # build to dist/
npm run dev          # watch mode (tsx)
npm start            # run MCP server on stdio
npm run typecheck    # type-check only, no emit
npm run lint         # eslint src/
npm run format       # prettier --write src/**/*.ts
```

## Testing

```bash
npm test                    # unit tests (vitest)
npm run test:watch          # watch mode
npm run test:coverage       # with coverage
npm run test:integration    # requires running Qdrant
npm run test:all            # unit + integration
```

Run a single test file: `npx vitest run src/core/searcher.test.ts`

Integration tests need Qdrant at `localhost:6333` and `OPENAI_API_KEY` set. Unit tests use mocks — no external services needed.

## Architecture

Single ESM package. MCP server over stdio that indexes codebases into a vector DB and provides hybrid semantic search.

**Data flow:** `index_codebase` → scan files → split into chunks (AST or line-based) → embed via OpenAI → store in Qdrant/Milvus. `search_code` → embed query → hybrid search (dense vector + full-text, fused via RRF) → deduplicate overlapping chunks → return results.

**Key interfaces** — the pluggable boundaries:
- `Embedding` (`src/embedding/types.ts`) — embed/embedBatch/estimateTokens. Implementations: OpenAI (`openai.ts`), factory selects by config.
- `VectorDB` (`src/vectordb/types.ts`) — createCollection/insert/search/deleteByPath. Implementations: Qdrant (primary, hybrid search), Milvus (optional fallback).
- `Splitter` (`src/splitter/types.ts`) — split code into chunks. AST splitter (tree-sitter) tried first, line splitter as fallback.

**Concurrency control:** `tools.ts` has a per-path mutex (`withMutex`) preventing concurrent indexing of the same codebase. Multiple different codebases can index in parallel.

**Incremental indexing:** `sync.ts` builds content-hash snapshots (SHA-256, truncated to 64 bits). On re-index, only added/modified files are re-embedded. Snapshots persist to `~/.eidetic/snapshots.db` (SQLite). See [architecture/snapshot-storage.md](architecture/snapshot-storage.md).

**Global by design:** Every tool takes an explicit absolute `path` parameter. Zero `process.cwd()` usage. All persistent data lives in `~/.eidetic/` (configurable via `EIDETIC_DATA_DIR`).

**stdout is sacred:** `console.log`/`console.warn` are redirected to stderr at the top of `index.ts`. Only MCP JSON protocol goes to stdout.

## Conventions

- **ESM only.** All imports use `.js` extensions.
- **TypeScript strict mode.** Target ES2022, module Node16.
- **Conventional commits.** `type(scope): description` — types: `feat`, `fix`, `docs`, `refactor`, `perf`, `chore`, `test`. Scopes: `embedding`, `vectordb`, `splitter`, `indexer`, `mcp`, `infra`, `config`.
- **No `process.cwd()` or `__dirname`.** Paths come from explicit arguments.
- **`paths.ts` is the single source of truth** for all path normalization (forward slashes, resolve to absolute, tilde expansion).

## Environment

Only `OPENAI_API_KEY` is required for default config. Qdrant auto-provisions via Docker if not running. Set `VECTORDB_PROVIDER=milvus` for Milvus, `EMBEDDING_PROVIDER=ollama` for local embeddings.

## Plugin

`plugin/` contains a Claude Code plugin with `.mcp.json` (auto-starts the server), skills (`catchup`, `wrapup`, `search`, `index`, `cache-docs`), 8 hook events (SessionStart, PreCompact, SessionEnd, PostToolUse, Stop, UserPromptSubmit, 2× PreToolUse), and a plugin manifest. The Read PreToolUse hook **blocks** built-in Read for text/code files and redirects to `read_file`.
