---
name: wrapup
description: Persist session state to memories and notes for future recovery
---

# /wrapup

## Step 1: Detect Project

```bash
PROJECT_ROOT=$(git rev-parse --show-toplevel 2>/dev/null)
if [ -n "$PROJECT_ROOT" ]; then
  PROJECT_NAME=$(basename "$PROJECT_ROOT")
  NOTES_DIR="$HOME/.eidetic/notes/$PROJECT_NAME"
  echo "PROJECT_NAME=$PROJECT_NAME"
  echo "NOTES_DIR=$NOTES_DIR"
else
  echo "NO_GIT_REPO"
fi
```

- Argument overrides PROJECT_NAME (e.g. `/wrapup myproject`).
- If NO_GIT_REPO and no argument, ask for project name.

## Step 2: Extract Facts

From the conversation, extract:
- **Decisions** (choice, rationale, alternatives rejected)
- **Changes** (exact file paths, what changed)
- **Numbers** (metrics, costs, counts)
- **Open questions** (mark OPEN or ASSUMED)
- **Next actions** (specific, actionable)
- **Blockers**

If nothing meaningful to persist, inform user and stop.

## Step 3: Store Memories

Store extracted knowledge as memories:

```
add_memory(
  facts=[
    { "fact": "<decision or convention>", "kind": "decision" },
    { "fact": "<code change description>", "kind": "fact" },
    { "fact": "<next action>", "kind": "intent" },
    ...
  ],
  project="<PROJECT_NAME>",
  source="wrapup"
)
```

## Step 4: Write Note

```bash
mkdir -p "$NOTES_DIR"
```

Filename: `$NOTES_DIR/<YYYY-MM-DD>-<topic-slug>.md` (kebab-case, max 3 words, today's date).

```
---
project: <PROJECT_NAME>
date: <YYYY-MM-DD>
branch: <current git branch>
---

# <PROJECT_NAME> — <YYYY-MM-DD>: <Topic Title>

**Date:** <YYYY-MM-DD>
**Project:** <PROJECT_NAME>

## Decisions
- **[Title]**: [Choice]. Rationale: [why]. Rejected: [alternatives].

## Changes
- `path/to/file.ts`: [what changed and why]

## Numbers
- [measurements, counts, costs]

## Open Questions
- **OPEN**: [needs decision]
- **ASSUMED**: [assumption, needs validation]

## Next Actions
1. [specific action]

---
*<PROJECT_NAME> session recorded <YYYY-MM-DD>*
```

Date and project appear 4 times for search reliability — keep all occurrences.

## Step 5: Confirm

Report: file path saved, memories stored, count of decisions/changes/open questions.
