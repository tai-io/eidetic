# 002: Replace category with kind field

## Status

Accepted

## Context

The memory system used a `category` field with values like `coding_style`, `tools`, `architecture`, `conventions`, `debugging`, `workflow`, `preferences`. This taxonomy mixed the nature of knowledge with its domain, making query-time weighting impractical.

## Decision

Replace `category` with `kind` — a five-value classification based on the nature of knowledge:

- **fact** — concrete, verifiable: "we use Qdrant 1.9"
- **decision** — rationale-bearing: "chose Qdrant over Pinecone because of payload filtering"
- **convention** — patterns/rules: "all tool handlers return MCP Result type"
- **constraint** — hard limits: "must work offline"
- **intent** — planned: "migrating from SQLite to Postgres next sprint"

## Consequences

- Query-classified weighting profiles (feasibility/rationale/procedural) can boost relevant kinds at search time
- Recency decay can be kind-specific (intents decay fast, constraints decay slow)
- Supersession works on same-kind memories (intent→fact lifecycle)
- All migrated entries default to `kind: "fact"` with `source: "migrated:<original_category>"`
- Breaking change to `add_memory` tool schema (`category` → `kind`)
