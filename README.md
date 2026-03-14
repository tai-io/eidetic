# Eidetic

Persistent memory for Claude Code. Store knowledge, recall by meaning, pick up where you left off.


[![tests](https://img.shields.io/github/actions/workflow/status/tai-io/eidetic/ci.yml?style=flat-square&label=tests)](https://github.com/tai-io/eidetic/actions/workflows/ci.yml)
[![npm](https://img.shields.io/npm/v/@tai-io/eidetic?style=flat-square)](https://www.npmjs.com/package/@tai-io/eidetic)
[![MIT](https://img.shields.io/badge/license-MIT-blue?style=flat-square)](LICENSE)

---

## Quick Start

```bash
export OPENAI_API_KEY=sk-...
claude plugin add @tai-io/eidetic
```

```
add_memory(
  query="error handling conventions",
  facts=[
    { fact: "Use typed errors at service boundaries", kind: "convention" },
    { fact: "Never use bare try/catch without re-throwing", kind: "constraint" }
  ]
)

search_memory("how do we handle errors")
```

That's it. Memories persist across sessions, projects, and context compactions.

---

## What It Does

### Persistent Memory

Claude forgets everything between sessions. Eidetic fixes that. `add_memory` stores structured facts grouped under the query that prompted them. Facts are deduplicated semantically, so storing the same knowledge twice just merges it.

`search_memory` retrieves relevant knowledge by meaning. Ask "how does auth work" and get back every decision, convention, and constraint you've stored about authentication, ranked by relevance.

Five kinds of knowledge: **fact**, **decision**, **convention**, **constraint**, **intent**.

### Session Continuity

When a session ends or context compacts mid-conversation, Eidetic automatically writes a structured note capturing what happened: files changed, decisions made, commands run, open questions. Start a new session with `/catchup` and pick up exactly where you left off.

### Automatic Extraction

Session hooks watch your conversations and extract durable knowledge (decisions, conventions, constraints) into a buffer. The buffer pipeline consolidates extractions via LLM and stores them as searchable memories. No manual `add_memory` calls needed for the most important stuff.

---

## Installation

### Plugin (recommended)

```bash
claude plugin add @tai-io/eidetic
```

The plugin starts the MCP server, installs skills, and configures hooks automatically.

<details>
<summary><strong>Other methods</strong></summary>

### npx (manual MCP config)

Add to your `.mcp.json`:

```json
{
  "mcpServers": {
    "eidetic": {
      "command": "npx",
      "args": ["-y", "@tai-io/eidetic"],
      "env": {
        "OPENAI_API_KEY": "sk-..."
      }
    }
  }
}
```

### Global install

```bash
npm install -g @tai-io/eidetic
claude mcp add -s user -e "OPENAI_API_KEY=$OPENAI_API_KEY" -- eidetic npx @tai-io/eidetic
```

### From source

```bash
git clone https://github.com/tai-io/eidetic
cd eidetic
npm install && npm run build && npm start
```

</details>

### Requirements

- Node.js >= 20
- `OPENAI_API_KEY` for embeddings

---

## Configuration

Set your OpenAI API key in your shell profile:

```bash
export OPENAI_API_KEY=sk-...   # macOS / Linux
setx OPENAI_API_KEY sk-...     # Windows
```

<details>
<summary><strong>All options</strong></summary>

| Variable | Default | Description |
|---|---|---|
| `OPENAI_API_KEY` | *(required)* | OpenAI API key for embeddings |
| `EMBEDDING_MODEL` | `text-embedding-3-small` | Embedding model name |
| `EMBEDDING_BATCH_SIZE` | `100` | Batch size for embedding requests (1-2048) |
| `OPENAI_BASE_URL` | *(none)* | Custom OpenAI-compatible endpoint |
| `EIDETIC_DATA_DIR` | `~/.eidetic/` | Data root for memory DB and session notes |

</details>

---

<details>
<summary><strong>Tools</strong></summary>

| Tool | Description |
|---|---|
| `add_memory` | Store facts grouped under a query. Deduplicates semantically. |
| `search_memory` | Search memories by meaning. Returns ranked results with facts. |
| `list_memories` | List all memories, filterable by kind or project. |
| `delete_memory` | Delete a memory group by ID. |
| `memory_history` | View change history for a memory. |

</details>

<details>
<summary><strong>Skills</strong></summary>

| Skill | Description |
|---|---|
| `/catchup` | Reconstruct session context from notes and memories |
| `/wrapup` | Extract decisions and next actions, persist to notes and memories |

</details>

---

## Development

```bash
npm install && npm run build    # install and build
npm run dev                     # watch mode
npm test                        # unit tests (no external services)
npm run lint                    # eslint
```

Commit format: `type(scope): description` / Types: `feat`, `fix`, `docs`, `refactor`, `test`, `chore`

---

## License

MIT
