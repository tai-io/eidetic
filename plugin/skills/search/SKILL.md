---
name: search
description: Semantic code search using Eidetic
---

# /search <query>

Search memories across all projects.

## Step 1: Check Global Index

The cross-project memory index was injected at session start. Scan it for entries relevant to the query.

If no index was injected, build one:

```bash
npx @tai-io/eidetic hook cross-project-index
```

## Step 2: Identify Relevant Files

From the index, identify memory files that might contain relevant information. Consider:
- Filename keywords matching the query
- Description text matching the query
- Project context (current project memories are more likely relevant)

## Step 3: Read Memory Files

Read the identified files from their native locations:

```
~/.claude/projects/<project-dir>/memory/<filename>.md
```

Read up to 5 most relevant files. The project-dir names are shown in the index headers.

## Step 4: Present Results

```
## Search: "<query>"

### From <project-name>
- **<memory-name>** (<type>): <key content summary>

### From <other-project>
- **<memory-name>** (<type>): <key content summary>

<N> memories found across <M> projects.
```

If no relevant results, suggest the user save knowledge with `/wrapup`.
