---
name: index
description: Index a codebase for Eidetic semantic search
---

# /index

Usage:
- `/eidetic:index` — index current project
- `/eidetic:index /path/to/project` — index specific path

## Step 1: Detect Path

Use the argument if provided. Otherwise:

```bash
git rev-parse --show-toplevel 2>/dev/null || echo "NO_GIT_REPO"
```

If NO_GIT_REPO and no argument, ask for path. Store as PROJECT_PATH.

## Step 2: Dry Run

```
index_codebase(path="<PROJECT_PATH>", dryRun=true)
```

Show file count, extensions, top directories, warnings, and estimated cost if available.

## Step 3: Index

```
index_codebase(path="<PROJECT_PATH>")
```

## Step 4: Verify

```
get_indexing_status(path="<PROJECT_PATH>")
```

Report: files indexed, chunk count, status.

## Step 5: RAPTOR Knowledge Generation

Generate architectural knowledge summaries from the indexed code:

```
raptor_cluster(path="<PROJECT_PATH>")
```

Review the output. For clusters that **do not** have cached summaries:

1. Spawn a Haiku agent (use `--model haiku` or `subagent_type: "general-purpose"` with model override) for each uncached cluster
2. Give the agent this prompt:
   > "Summarize this code cluster into 2-4 sentences describing its architectural purpose, key patterns used, and relationships to other components."
3. Include the cluster's chunk contents in the agent prompt

Collect all generated summaries, then store them:

```
raptor_store_summaries(path="<PROJECT_PATH>", summaries=[
  { "clusterId": "<hash>", "summary": "<agent output>" },
  ...
])
```

**Skip this step** if `raptor_cluster` returns 0 clusters or all clusters are cached.

## Step 6: What's Next

Suggest these next actions:
- `search_code("how does X work")` — try a semantic search on this codebase
- `/cache-docs <library>` — cache docs for a library you use frequently (e.g., React, Express)
