#!/usr/bin/env bash
set -euo pipefail

# Ensure working tree is clean
if [[ -n "$(git status --porcelain)" ]]; then
  echo "Error: working tree is not clean. Commit or stash changes first." >&2
  exit 1
fi

# Ensure on main branch
BRANCH="$(git rev-parse --abbrev-ref HEAD)"
if [[ "$BRANCH" != "main" ]]; then
  echo "Error: must be on main branch to release (currently on: $BRANCH)" >&2
  exit 1
fi

echo "Triggering CalVer release via GitHub Actions..."
gh workflow run release.yml
echo "Monitor at: https://github.com/tai-io/eidetic/actions/workflows/release.yml"
