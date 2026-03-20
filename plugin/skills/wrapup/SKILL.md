---
name: wrapup
description: Persist session working state to searchable notes for future recovery (pre-compaction)
---

# /wrapup

Distill session knowledge into native memory files and session notes.

## Step 1: Detect Project

Determine the Claude project memory directory:

```bash
echo "CLAUDE_PROJECT=${CLAUDE_PROJECT:-unknown}"
echo "MEMORY_DIR=$HOME/.claude/projects/$CLAUDE_PROJECT/memory"
```

If CLAUDE_PROJECT is not set, ask the user which project to save to.

## Step 2: Review Session

Scan this conversation for knowledge worth persisting across sessions:

- **Feedback** — corrections, preferences, approach guidance (type: feedback)
- **Decisions** — architectural choices, trade-offs, rationale (type: project)
- **References** — external URLs, tools, dashboards, documentation (type: reference)
- **User context** — role, expertise, responsibilities (type: user)
- **Project state** — ongoing work, blockers, deadlines (type: project)

Skip anything that:
- Is already in the project's existing memory files
- Can be derived from code or git history
- Is only relevant to this conversation (use session notes instead)

If nothing worth persisting, inform the user and skip to Step 4.

## Step 3: Write Memory Files

For each memory to persist, create a file in the native memory directory.

**File format** — `~/.claude/projects/<CLAUDE_PROJECT>/memory/<slug>.md`:
```markdown
---
name: descriptive_name
description: One-line description for relevance matching
type: user|feedback|project|reference
---

Memory content in freeform markdown.
```

**Naming:** Use a descriptive slug prefixed with the type, e.g.:
- `feedback_no_mocks_in_integration_tests.md`
- `project_auth_middleware_rewrite.md`
- `reference_grafana_latency_dashboard.md`
- `user_senior_backend_engineer.md`

After writing each file, add an entry to MEMORY.md:
```markdown
- [filename.md](filename.md) — one-line description
```

Read MEMORY.md first to avoid duplicating existing entries.

## Step 4: Write Session Note

```bash
NOTES_DIR="$HOME/.eidetic/notes/$(basename $(git rev-parse --show-toplevel 2>/dev/null) 2>/dev/null || echo unknown)"
mkdir -p "$NOTES_DIR"
```

Write a session note to `$NOTES_DIR/<YYYY-MM-DD>-<topic-slug>.md`:

```markdown
---
project: <PROJECT_NAME>
date: <YYYY-MM-DD>
branch: <current git branch>
---

# <PROJECT_NAME> — <YYYY-MM-DD>: <Topic>

## Decisions
- **[Title]**: [Choice]. Rationale: [why].

## Changes
- `path/to/file.ts`: [what changed]

## Open Questions
- [needs decision or validation]

## Next Actions
1. [specific action]
```

## Step 5: Confirm

Report:
- Memory files written (count and names)
- Session note path
- Any memories skipped (already existed)
