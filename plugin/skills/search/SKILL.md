---
name: search
description: Semantic code search using Codesearch
---

# /search

Usage: `/eidetic:search <query>`

## Step 1: Parse Query

Use the argument as the query. If none, ask: "What would you like to search for?"

## Step 2: Detect Path

```bash
git rev-parse --show-toplevel 2>/dev/null || echo "NO_GIT_REPO"
```

If NO_GIT_REPO, ask for the path. Store as PROJECT_PATH.

## Step 3: Check Index

```
get_indexing_status(path="<PROJECT_PATH>")
```

If not indexed: "Run `/eidetic:index` first, or I can index now." If user agrees, run `index_codebase(path="<PROJECT_PATH>")` then continue.

## Step 4: Search

```
search_code(path="<PROJECT_PATH>", query="<USER_QUERY>", limit=10)
```

## Step 5: Present Results

```
## Search: "<query>" in <project>
1. `path/to/file.ts:42` — <snippet>
2. `path/to/other.ts:15` — <snippet>
**<N> results** | <file count> files indexed
```

If no results: suggest different terms, check index completeness, or use Grep for exact matches.
