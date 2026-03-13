#!/usr/bin/env bash
# Eidetic SessionEnd hook — captures session state and extracts semantic memories
cat | npx @tai-io/eidetic hook session-end
