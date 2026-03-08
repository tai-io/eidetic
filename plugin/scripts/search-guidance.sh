#!/bin/bash
# Only inject guidance when the MCP server can actually serve requests
if [ -z "$OPENAI_API_KEY" ] && [ "${EMBEDDING_PROVIDER:-openai}" = "openai" ]; then
  exit 0
fi

cat <<'EOF'
{"hookSpecificOutput":{"hookEventName":"UserPromptSubmit","additionalContext":"IMPORTANT — Use search_code FIRST for any code search. It uses semantic search (~20 tokens/result).\n- search_code(query) — ALWAYS use this first for any concept, symbol, or keyword search.\n- browse_structure() — architecture map in one call. Use before Glob cascades or Explore agents.\nUse Grep ONLY for exact regex patterns (e.g., \"function\\s+\\w+\", \"import.*from\"). Use Glob only for exact filenames.\n\n**Proactive memory:** Call add_memory(facts) to persist reusable knowledge across sessions:\n- Failed URLs/endpoints and working alternatives\n- Design decisions and rationale\n- Debugging root causes and fixes\nsearch_memory(query) retrieves past knowledge."}}
EOF
