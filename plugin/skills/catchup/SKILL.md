---
name: catchup
description: Recover session context from markdown notes
---

# /catchup

Recover context from session notes and cross-project memory.

## Step 1: Detect Project

```bash
PROJECT_ROOT=$(git rev-parse --show-toplevel 2>/dev/null)
PROJECT_NAME=$(basename "$PROJECT_ROOT" 2>/dev/null || echo "unknown")
NOTES_DIR="$HOME/.eidetic/notes/$PROJECT_NAME"
echo "PROJECT_NAME=$PROJECT_NAME"
echo "NOTES_DIR=$NOTES_DIR"
echo "EXISTS=$([ -d "$NOTES_DIR" ] && echo yes || echo no)"
```

Argument overrides PROJECT_NAME (e.g. `/catchup myproject`).

## Step 2: Read Session Notes

If notes directory exists:

```bash
ls -t "$NOTES_DIR"/*.md 2>/dev/null | head -3
```

Read the 2-3 most recent note files.

## Step 3: Check Cross-Project Index

The global cross-project memory index was injected at session start. Review it for relevant memories from OTHER projects. If you see potentially useful entries, use `/search` to read them.

## Step 4: Present Summary

```
## Catchup: <PROJECT_NAME>
**Last session:** <date> | **Branch:** <branch> | **Status:** <1-line>
- <Key decision or change>
- <Open question>
- <Next action>
**Notes:** <N> files, <date range>
**Cross-project:** <N> related memories from other projects (use /search to explore)
```

Expand only if user asks.
