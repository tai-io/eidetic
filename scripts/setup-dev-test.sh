#!/usr/bin/env bash
# Sets up a test project to use the local @tai-io/eidetic plugin and MCP server.
# Usage: bash scripts/setup-dev-test.sh [target-dir]
#   target-dir defaults to current directory

set -euo pipefail

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
PLUGIN_DIR="$REPO_ROOT/plugin"
TARGET="${1:-.}"
TARGET="$(cd "$TARGET" && pwd)"

echo "Repo root : $REPO_ROOT"
echo "Plugin dir: $PLUGIN_DIR"
echo "Target dir: $TARGET"
echo ""

# ── MCP server ────────────────────────────────────────────────────────────────

MCP_FILE="$TARGET/.mcp.json"
EIDETIC_ENTRY=$(cat <<EOF
{
      "command": "node",
      "args": ["$REPO_ROOT/dist/index.js"],
      "env": {
        "OPENAI_API_KEY": "\${OPENAI_API_KEY}"
      }
    }
EOF
)

if [ -f "$MCP_FILE" ] && command -v node &>/dev/null; then
  # Merge @tai-io/eidetic entry into existing file, preserving other servers
  MERGE_SCRIPT=$(mktemp)
  cat > "$MERGE_SCRIPT" <<JSEOF
const fs = require('fs');
const file = process.argv[2];
const existing = JSON.parse(fs.readFileSync(file, 'utf8'));
existing.mcpServers = existing.mcpServers || {};
existing.mcpServers['@tai-io/eidetic'] = $EIDETIC_ENTRY;
fs.writeFileSync(file, JSON.stringify(existing, null, 2) + '\n');
JSEOF
  node "$MERGE_SCRIPT" "$MCP_FILE"
  rm "$MERGE_SCRIPT"
else
  cat > "$MCP_FILE" <<EOF
{
  "mcpServers": {
    "@tai-io/eidetic": $EIDETIC_ENTRY
  }
}
EOF
fi
echo "✓ .mcp.json"

# ── Wrapper scripts ────────────────────────────────────────────────────────────
# Claude Code on Windows runs hook commands via cmd.exe, so VARIABLE=value bash
# syntax doesn't work. Instead we generate wrapper scripts that export
# CLAUDE_PLUGIN_ROOT before calling the real hook.

WRAPPERS_DIR="$TARGET/.claude/dev-hooks"
mkdir -p "$WRAPPERS_DIR"

make_wrapper() {
  local name="$1"   # e.g. session-start
  local target="$2" # e.g. hooks/session-start.sh
  local out="$WRAPPERS_DIR/$name.sh"

  cat > "$out" <<WRAPPER
#!/usr/bin/env bash
export CLAUDE_PLUGIN_ROOT="$PLUGIN_DIR"
INPUT=\$(cat)
echo "\$INPUT" | bash "$PLUGIN_DIR/$target"
WRAPPER
  chmod +x "$out"
}


make_wrapper       "session-start"      "hooks/session-start.sh"
make_wrapper       "precompact"         "hooks/precompact-hook.sh"
make_wrapper       "session-end"        "hooks/session-end-hook.sh"
make_wrapper       "post-tool-extract" "hooks/post-tool-extract.sh"
make_wrapper       "user-prompt-inject" "hooks/user-prompt-inject.sh"
make_wrapper       "search-guidance"   "scripts/search-guidance.sh"
make_wrapper       "prefer-eidetic"    "scripts/prefer-eidetic.sh"
make_wrapper       "prefer-search"     "scripts/prefer-search.sh"
make_wrapper       "prefer-docs-cache" "scripts/prefer-docs-cache.sh"

echo "✓ .claude/dev-hooks/ (wrapper scripts)"

# ── Hooks (settings.json) ─────────────────────────────────────────────────────

mkdir -p "$TARGET/.claude"
W="$WRAPPERS_DIR"

cat > "$TARGET/.claude/settings.json" <<EOF
{
  "hooks": {
    "SessionStart": [
      { "hooks": [{ "type": "command", "command": "bash \"$W/session-start.sh\"", "timeout": 5 }] }
    ],
    "PreCompact": [
      { "hooks": [{ "type": "command", "command": "bash \"$W/precompact.sh\"", "timeout": 10 }] }
    ],
    "SessionEnd": [
      { "hooks": [{ "type": "command", "command": "bash \"$W/session-end.sh\"", "timeout": 30 }] }
    ],
    "UserPromptSubmit": [
      { "hooks": [{ "type": "command", "command": "bash \"$W/search-guidance.sh\"", "timeout": 3 }] },
      { "hooks": [{ "type": "command", "command": "bash \"$W/user-prompt-inject.sh\"", "timeout": 4 }] }
    ],
    "PostToolUse": [
      {
        "matcher": "WebFetch|Bash",
        "hooks": [{ "type": "command", "command": "bash \"$W/post-tool-extract.sh\"", "timeout": 10 }]
      }
    ],
    "PreToolUse": [
      {
        "matcher": "Read",
        "hooks": [{ "type": "command", "command": "bash \"$W/prefer-eidetic.sh\"", "timeout": 5 }]
      },
      {
        "matcher": "Grep",
        "hooks": [{ "type": "command", "command": "bash \"$W/prefer-search.sh\"", "timeout": 5 }]
      },
      {
        "matcher": "query-docs|query_docs|resolve-library-id|resolve_library_id|WebFetch",
        "hooks": [{ "type": "command", "command": "bash \"$W/prefer-docs-cache.sh\"", "timeout": 5 }]
      }
    ]
  }
}
EOF
echo "✓ .claude/settings.json"

# ── Skills ────────────────────────────────────────────────────────────────────

SKILLS_LINK="$TARGET/.claude/skills"

if [ -L "$SKILLS_LINK" ]; then
  rm "$SKILLS_LINK"
elif [ -d "$SKILLS_LINK" ]; then
  rm -rf "$SKILLS_LINK"
fi

ln -s "$PLUGIN_DIR/skills" "$SKILLS_LINK"
echo "✓ .claude/skills -> $PLUGIN_DIR/skills"

echo ""
echo "Done. Open a Claude Code session in: $TARGET"
echo "Run 'npx tsc' in $REPO_ROOT first if you haven't built yet."
