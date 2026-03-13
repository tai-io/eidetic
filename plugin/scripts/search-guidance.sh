#!/bin/bash
# Only inject guidance when the MCP server can actually serve requests
if [ -z "$OPENAI_API_KEY" ] && [ "${EMBEDDING_PROVIDER:-openai}" = "openai" ]; then
  exit 0
fi

cat <<'EOF'
{"hookSpecificOutput":{"hookEventName":"UserPromptSubmit","additionalContext":"**Proactive memory:** Call add_memory(facts) to persist reusable knowledge across sessions:\n- Failed URLs/endpoints and working alternatives\n- Design decisions and rationale\n- Debugging root causes and fixes\n- Environment quirks or setup steps\nsearch_memory(query) retrieves past knowledge."}}
EOF
