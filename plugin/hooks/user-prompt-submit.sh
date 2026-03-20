#!/usr/bin/env bash
# Gentle nudge to Claude about native auto memory
cat <<'EOF'
{"hookSpecificOutput":{"hookEventName":"UserPromptSubmit","additionalContext":"**Proactive memory:** When you learn something reusable (decisions, conventions, corrections, external references), save it to ~/.claude/projects/$CLAUDE_PROJECT/memory/ using the Write tool with YAML frontmatter (name, description, type) and update MEMORY.md."}}
EOF
