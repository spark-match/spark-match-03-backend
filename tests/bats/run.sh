#!/usr/bin/env bash
# SPDX-License-Identifier: Apache-2.0
# Copyright (C) 2026 Spark Match
# =============================================================================
# run.sh - run all *.bats tests in this directory
# =============================================================================
# Lightweight local runner. bats-core is not bundled with the repo; install
# it once on your dev machine (apt-get install bats / brew install bats-core,
# or via the devops composite bats-runner action in CI).
#
# Usage:
#   ./tests/bats/run.sh          # Unix-like shells (bash, zsh)
#   npm run test:bats            # via npm, also works on Windows
#
# Exit code: 0 if all tests pass, 1 otherwise.
# =============================================================================

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}" 2>/dev/null || dirname "$0")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/../.." && pwd)"

# bats-core location. On Windows, npm run uses cmd.exe which doesn't have
# `bash` in PATH by default; check the canonical Windows location before
# bailing.
BATS_BIN="$(command -v bats 2>/dev/null || true)"
if [[ -z "$BATS_BIN" ]]; then
  for candidate in \
    "C:/Users/Angel/.local/bin/bats" \
    "/c/Users/Angel/.local/bin/bats" \
    "/usr/bin/bats" \
    "/usr/local/bin/bats"; do
    if [[ -x "$candidate" ]]; then
      BATS_BIN="$candidate"
      break
    fi
  done
fi
if [[ -z "$BATS_BIN" ]]; then
  echo "bats not found in PATH. Install bats-core:" >&2
  echo "  Linux:  apt-get install -y bats" >&2
  echo "  macOS:  brew install bats-core" >&2
  echo "  Manual: https://github.com/bats-core/bats-core" >&2
  exit 1
fi

cd "$REPO_ROOT"
exec "$BATS_BIN" "$SCRIPT_DIR"
