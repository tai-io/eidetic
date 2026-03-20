#!/usr/bin/env bash
# Eidetic SessionStart hook — injects last-session context + cross-project memory index

# Tier-0: compact summary from most recent session (best-effort)
npx @tai-io/eidetic hook tier0-inject 2>/dev/null || true

# Cross-project memory index: scan all project memory dirs
npx @tai-io/eidetic hook cross-project-index 2>/dev/null || true
