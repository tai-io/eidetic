---
name: catchup
description: Recover session context from Eidetic memories and notes
---

# /catchup

## Step 1: Detect Project

```bash
PROJECT_ROOT=$(git rev-parse --show-toplevel 2>/dev/null)
if [ -n "$PROJECT_ROOT" ]; then
  PROJECT_NAME=$(basename "$PROJECT_ROOT")
  NOTES_DIR="$HOME/.eidetic/notes/$PROJECT_NAME"
  echo "PROJECT_NAME=$PROJECT_NAME"
  echo "NOTES_DIR=$NOTES_DIR"
  echo "EXISTS=$([ -d "$NOTES_DIR" ] && echo yes || echo no)"
  echo "FILE_COUNT=$([ -d "$NOTES_DIR" ] && ls "$NOTES_DIR"/*.md 2>/dev/null | wc -l || echo 0)"
else
  echo "NO_GIT_REPO"
fi
```

- Argument overrides PROJECT_NAME (e.g. `/catchup myproject`).
- If NO_GIT_REPO and no argument, ask for project name.

## Step 2: Search Memories

```
search_memory(query="recent decisions and changes", project="<PROJECT_NAME>", limit=10)
```

## Step 3: Read Recent Notes

If notes directory exists:

```bash
ls -t "$NOTES_DIR"/*.md 2>/dev/null | head -3
```

Read the top 2-3 most recent note files.

## Step 4: Optionally Search Code Context

If codesearch is available and the notes are indexed:

```
search_code(path="<NOTES_DIR>", query="recent decisions and changes for <PROJECT_NAME>", limit=5)
```

## Step 5: Present Summary

```
## Catchup: <PROJECT_NAME>
**Last session:** <date> | **Status:** <1-line status>
- <Key decision or change>
- <Critical open question>
- <Next action>
**Memories:** <N> relevant | **Notes:** <N> files, <date range>
```

Expand only if user asks.
