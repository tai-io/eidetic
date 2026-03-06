```
┌─────────────────────────────────────────────┐
│  ╔═╗╦╔╦╗╔═╗╔╦╗╦╔═╗                         │
│  ║╣ ║ ║║║╣  ║ ║║    semantic code search    │
│  ╚═╝╩═╩╝╚═╝ ╩ ╩╚═╝  for Claude Code        │
└─────────────────────────────────────────────┘
```

[![tests](https://img.shields.io/github/actions/workflow/status/eidetics/claude-eidetic/ci.yml?style=flat-square&label=tests)](https://github.com/eidetics/claude-eidetic/actions/workflows/ci.yml)
[![npm](https://img.shields.io/npm/v/claude-eidetic)](https://www.npmjs.com/package/claude-eidetic)
[![MIT](https://img.shields.io/badge/license-MIT-blue.svg)](LICENSE)

Semantic code search, persistent memory, and session continuity for Claude Code. One plugin, not three.

---

## Quick Start

```bash
claude plugin marketplace add eidetics/claude-eidetic
claude plugin install claude-eidetic
```

```bash
export OPENAI_API_KEY=sk-...  # for embeddings (default)
```

Index your codebase once, then search by meaning:

```
index_codebase(path="/your/project")
search_code("how does authentication work")
```

---

## Features

### Semantic Code Search

**Find code by meaning, not keywords.** Search across your entire codebase with natural language, returning the most relevant functions and classes, not a list of files to read.

```
search_code("how does the retry logic work")
search_code("authentication middleware", extensionFilter=[".ts"])
search_code(project="backend", query="auth flow")
```

### Architecture at a Glance

**Get every class, function, and method in one call.** `browse_structure` returns a condensed map of your codebase with signatures, grouped by file, replacing a Glob + Read cascade with a single tool call.

```
browse_structure(path="/my/project", kind="class")
list_symbols(path="/my/project", nameFilter="handle")
```

### Documentation Cache

**Fetch docs once, search them forever.** Cache external documentation as searchable embeddings. Retrieve relevant passages instantly, far cheaper than re-fetching the same page each session.

```
index_document(content=..., library="react", topic="hooks", source="https://...")
search_documents("React useCallback dependencies", library="react")
```

### Persistent Memory

**Claude remembers your preferences between sessions.** `add_memory` uses an LLM to extract structured facts from conversation text (coding style, architecture decisions, debugging insights) and deduplicates them semantically. Not a static config file you forget to update.

```
add_memory("Always use absolute imports, never relative")
search_memory("how does this team handle errors")
```

### Session Continuity

**Every session picks up where the last one left off.** When a session ends (or context compacts mid-session), Eidetic automatically writes a structured note capturing files changed, tasks, commands, and decisions. `/catchup` at the start of a new session reconstructs exactly where you were. No user action required.

### Invisible Optimizations

Eight hook events fire automatically, nudging toward cheaper tools, redirecting file reads for 15-20% token savings, tracking changed files, and saving session state on exit.

<details>
<summary><strong>Hook event details</strong></summary>

| Hook | Trigger | What it does |
|---|---|---|
| `SessionStart` | Session opens | Validates config, injects last-session context |
| `UserPromptSubmit` | Every message | Nudges toward `search_code` over Grep/Explore for conceptual queries |
| `PreToolUse` (Read) | Before every Read | Blocks Read for text files, redirects to `read_file` for 15-20% token savings |
| `PreToolUse` (WebFetch / query-docs) | Before doc fetches | Suggests `search_documents` if library is cached (allows fetch either way) |
| `PostToolUse` (Write / Edit) | After every file write | Tracks changed files in a shadow git index |
| `Stop` | After Claude responds | Commits shadow index; triggers targeted re-index of changed files only |
| `PreCompact` | Before context compaction | Captures session state to notes before memory is lost |
| `SessionEnd` | Session closes | Writes session note (files, tasks, commands); extracts developer memories via LLM |

</details>

---

## When to Use What

| Need | Use | Notes |
|---|---|---|
| Find implementations by concept | `search_code` | Semantic, natural language queries |
| Exact string or regex match | Grep | Grep wins for exact matches |
| Find file by exact name | Glob | Glob wins for name patterns |
| Understand module structure | `browse_structure` | One call vs Glob + Read cascade |
| Read a specific known file | `read_file` | Cheaper than built-in Read for code files |
| Search cached documentation | `search_documents` | Far cheaper than re-fetching |
| Recall project conventions | `search_memory` | Global across all projects and sessions |

---

## Skills Reference

| Skill | What it does |
|---|---|
| `/search` | Guided semantic search with best-practice prompts |
| `/index` | Index or re-index a codebase with dry-run option |
| `/cache-docs` | Fetch and cache external documentation |
| `/catchup` | Search session notes and reconstruct where you left off |
| `/wrapup` | Extract decisions, rationale, open questions, and next actions from the conversation |

---

<details>
<summary><strong>Why does this exist? (The Problem)</strong></summary>

Every new Claude Code session starts cold. You re-explain the architecture. You re-fetch the same docs. Claude reads the same files repeatedly, burning tokens just to get back to where you were.

| Task | Without Eidetic | With Eidetic |
|---|---|---|
| Find where auth errors are handled | Grep cascade, read 8 files, ~10,700 tokens | `search_code("auth error handling")` ~220 tokens |
| Resume after context compaction | Re-explain 20 min of context, ~2,000 tokens | `/catchup` ~200 tokens |
| Look up React hooks docs | Fetch docs page, ~5,000 tokens | `search_documents("React useEffect")` ~20 tokens |
| Read a 400-line file | Built-in Read with line numbers, ~900 tokens | `read_file(path)` ~740 tokens |

</details>

---

## Installation

### Plugin (recommended)

```bash
claude plugin marketplace add eidetics/claude-eidetic
claude plugin install claude-eidetic
```

The plugin auto-starts the MCP server, installs skills, and configures hooks.

<details>
<summary><strong>Alternative installation methods</strong></summary>

### npx (manual MCP config)

Add to your `.mcp.json`:

```json
{
  "mcpServers": {
    "claude-eidetic": {
      "command": "npx",
      "args": ["-y", "claude-eidetic"],
      "env": {
        "OPENAI_API_KEY": "sk-..."
      }
    }
  }
}
```

### Global install

```bash
npm install -g claude-eidetic
```

### From source

```bash
git clone https://github.com/eidetics/claude-eidetic
cd claude-eidetic
npm install && npx tsc && npm start
```

</details>

### Requirements

- Node.js >= 20.0.0
- An API key (OpenAI for embeddings, or Ollama for free local embeddings)
- Docker (optional): only needed if using Qdrant provider (`VECTORDB_PROVIDER=qdrant`)
- C/C++ build tools: required by tree-sitter native bindings (`node-gyp`)

---

## Configuration

All configuration is via environment variables. No config files.

### Using Ollama (free, local)

```bash
export EMBEDDING_PROVIDER=ollama
export MEMORY_LLM_PROVIDER=ollama
# No API keys needed
```

<details>
<summary><strong>Full configuration reference</strong></summary>

| Variable | Default | Description |
|---|---|---|
| `OPENAI_API_KEY` | _(required for openai)_ | OpenAI API key for embeddings |
| `EMBEDDING_PROVIDER` | `openai` | `openai`, `ollama`, or `local` |
| `EMBEDDING_MODEL` | `text-embedding-3-small` (openai) / `nomic-embed-text` (ollama) | Embedding model name |
| `EMBEDDING_BATCH_SIZE` | `100` | Batch size for embedding requests (1-2048) |
| `INDEXING_CONCURRENCY` | `8` | Parallel file indexing workers (1-32) |
| `OPENAI_BASE_URL` | _(none)_ | Custom OpenAI-compatible endpoint |
| `OLLAMA_BASE_URL` | `http://localhost:11434/v1` | Ollama server URL |
| `VECTORDB_PROVIDER` | `chroma` | `chroma`, `qdrant`, or `milvus` |
| `CHROMA_DATA_DIR` | `~/.eidetic/chroma/` | ChromaDB persistent data directory |
| `QDRANT_URL` | `http://localhost:6333` | Qdrant server URL (when using qdrant provider) |
| `QDRANT_API_KEY` | _(none)_ | Qdrant API key (for remote/cloud instances) |
| `MILVUS_ADDRESS` | `localhost:19530` | Milvus server address |
| `MILVUS_TOKEN` | _(none)_ | Milvus authentication token |
| `EIDETIC_DATA_DIR` | `~/.eidetic/` | Data root for snapshots, memory DB, registry |
| `CUSTOM_EXTENSIONS` | `[]` | JSON array of extra file extensions to index (e.g., `[".dart",".arb"]`) |
| `CUSTOM_IGNORE_PATTERNS` | `[]` | JSON array of glob patterns to exclude |

</details>

---

## Troubleshooting

### `OPENAI_API_KEY` not set

Eidetic needs an embedding API key. Set it in your shell profile:

```bash
export OPENAI_API_KEY=sk-...   # macOS/Linux
setx OPENAI_API_KEY sk-...     # Windows
```

Or use Ollama for free local embeddings: `export EMBEDDING_PROVIDER=ollama`

### Using Qdrant instead of Chroma

ChromaDB is the default (no Docker needed). To use Qdrant:

```bash
export VECTORDB_PROVIDER=qdrant
```

Qdrant auto-provisions via Docker. If Docker isn't installed:
- **Option A:** Install [Docker Desktop](https://www.docker.com/products/docker-desktop/) and retry
- **Option B:** Run Qdrant manually and set `QDRANT_URL` to point to it

### Tree-sitter native build fails on Windows

Tree-sitter requires C/C++ build tools. Install them:

```bash
npm install -g windows-build-tools   # or install Visual Studio Build Tools
```

If the build still fails, Eidetic falls back to line-based chunking (works, but less precise).

### Ollama model not pulled

If using `EMBEDDING_PROVIDER=ollama`, ensure the model is available:

```bash
ollama pull nomic-embed-text
```

---

<details>
<summary><strong>Tool Reference</strong></summary>

### Code Search

| Tool | Description |
|---|---|
| `search_code` | Hybrid semantic search over indexed codebase. Returns compact results by default. |
| `index_codebase` | Index a directory. Supports `dryRun`, `force`, `customExtensions`, `customIgnorePatterns`. |
| `list_indexed` | List all indexed codebases with file/chunk counts and status. |
| `get_indexing_status` | Check indexing progress for a path or project. |
| `clear_index` | Remove the search index for a codebase. |
| `cleanup_vectors` | Remove orphaned vectors for deleted files. No re-embedding cost. |
| `browse_structure` | Condensed structural map: classes, functions, methods with signatures, grouped by file. |
| `list_symbols` | Compact symbol table with name/kind/file/line. Supports name, kind, and path filters. |

### File Reading

| Tool | Description |
|---|---|
| `read_file` | Read file without line-number overhead. Cheaper than built-in Read for code files. |

### Documentation Cache

| Tool | Description |
|---|---|
| `index_document` | Cache external documentation for semantic search. Supports TTL for staleness tracking. |
| `search_documents` | Search cached docs. Far cheaper than re-fetching the same page. |

### Memory

| Tool | Description |
|---|---|
| `add_memory` | LLM-extracted facts from text. Auto-deduplicates. Seven categories. |
| `search_memory` | Semantic search over stored memories. Filterable by category. |
| `list_memories` | List all memories, optionally filtered by category. |
| `delete_memory` | Delete a specific memory by UUID. |
| `memory_history` | View change history for a memory (additions, updates, deletions). |

</details>

---

## Supported Languages

**AST-aware** (functions and classes chunked intact):

<p>
  <img src="https://img.shields.io/badge/JavaScript-F7DF1E?style=flat-square&logo=javascript&logoColor=black" alt="JavaScript"/>
  <img src="https://img.shields.io/badge/TypeScript-3178C6?style=flat-square&logo=typescript&logoColor=white" alt="TypeScript"/>
  <img src="https://img.shields.io/badge/React_(JSX/TSX)-61DAFB?style=flat-square&logo=react&logoColor=black" alt="JSX/TSX"/>
  <img src="https://img.shields.io/badge/Python-3776AB?style=flat-square&logo=python&logoColor=white" alt="Python"/>
  <img src="https://img.shields.io/badge/Go-00ADD8?style=flat-square&logo=go&logoColor=white" alt="Go"/>
  <img src="https://img.shields.io/badge/Java-ED8B00?style=flat-square&logo=openjdk&logoColor=white" alt="Java"/>
  <img src="https://img.shields.io/badge/Rust-000000?style=flat-square&logo=rust&logoColor=white" alt="Rust"/>
  <img src="https://img.shields.io/badge/C-A8B9CC?style=flat-square&logo=c&logoColor=black" alt="C"/>
  <img src="https://img.shields.io/badge/C++-00599C?style=flat-square&logo=cplusplus&logoColor=white" alt="C++"/>
  <img src="https://img.shields.io/badge/C%23-512BD4?style=flat-square&logo=csharp&logoColor=white" alt="C#"/>
</p>

**Line-based fallback** (sliding window chunking for everything else):

<p>
  <img src="https://img.shields.io/badge/Markdown-000000?style=flat-square&logo=markdown&logoColor=white" alt="Markdown"/>
  <img src="https://img.shields.io/badge/YAML-CB171E?style=flat-square&logo=yaml&logoColor=white" alt="YAML"/>
  <img src="https://img.shields.io/badge/JSON-000000?style=flat-square&logo=json&logoColor=white" alt="JSON"/>
  <img src="https://img.shields.io/badge/Ruby-CC342D?style=flat-square&logo=ruby&logoColor=white" alt="Ruby"/>
  <img src="https://img.shields.io/badge/PHP-777BB4?style=flat-square&logo=php&logoColor=white" alt="PHP"/>
  <img src="https://img.shields.io/badge/Swift-F05138?style=flat-square&logo=swift&logoColor=white" alt="Swift"/>
  <img src="https://img.shields.io/badge/Kotlin-7F52FF?style=flat-square&logo=kotlin&logoColor=white" alt="Kotlin"/>
  <img src="https://img.shields.io/badge/and_more...-30363d?style=flat-square" alt="and more"/>
</p>

---

## Development

```bash
npm install && npx tsc    # install and build
npm run dev               # watch mode (tsx)
npm test                  # unit tests (no external services needed)
npm run test:integration  # requires Qdrant at localhost:6333 + OPENAI_API_KEY
```

**Commit format:** `type(scope): description`
Types: `feat`, `fix`, `docs`, `refactor`, `perf`, `chore`, `test`
Scopes: `embedding`, `vectordb`, `splitter`, `indexer`, `mcp`, `infra`, `config`

---

## Acknowledgements

Heavily inspired by [mem0](https://github.com/mem0ai/mem0), [claude-mem](https://github.com/thedotmack/claude-mem), and [claude-context](https://github.com/zilliztech/claude-context). Documentation retrieval powered by [context7](https://github.com/upstash/context7).

---

## License

MIT
