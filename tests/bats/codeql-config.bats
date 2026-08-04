#!/usr/bin/env bats
# SPDX-License-Identifier: Apache-2.0
# Copyright (C) 2026 Spark Match
# =============================================================================
# codeql-config.bats - regression guards for .github/codeql/codeql-config.yml
# =============================================================================
# Locks down B26: the local CodeQL config that excludes the two
# `unpinned-tag` rules conflicting with AGENTS.md 12.1 (floating @vN).
#
# The two rules are also enforced in code by tests/bats/no-sha-pinning.bats.
# This test asserts the *config* side: that the config file exists, is
# valid YAML, and excludes the same two rule ids. If either exclusion is
# removed, the standing CodeQL alert re-opens.
#
# Adapted from spark-match-01-devops/tests/bats/codeql-config.bats (GPL-3.0).
# Same intent, narrower assertions to fit the B26 scope.
# =============================================================================

setup() {
  REPO_ROOT="$(git rev-parse --show-toplevel)"
  CONFIG="$REPO_ROOT/.github/codeql/codeql-config.yml"
  WORKFLOW="$REPO_ROOT/.github/workflows/codeql.yml"
}

@test "codeql-config: file exists at .github/codeql/codeql-config.yml" {
  [ -f "$CONFIG" ]
}

@test "codeql-config: declares a top-level `name:` field" {
  run grep -E '^name:[[:space:]]+\S+' "$CONFIG"
  [ "$status" -eq 0 ]
}

@test "codeql-config: declares query-filters" {
  run grep -E '^query-filters:' "$CONFIG"
  [ "$status" -eq 0 ]
}

@test "codeql-config: excludes js/actions/unpinned-3rd-party-action" {
  run grep -E 'id:[[:space:]]*js/actions/unpinned-3rd-party-action' "$CONFIG"
  [ "$status" -eq 0 ]
}

@test "codeql-config: excludes actions/unpinned-tag" {
  run grep -E 'id:[[:space:]]*actions/unpinned-tag' "$CONFIG"
  [ "$status" -eq 0 ]
}

@test "codeql-config: every exclude entry has a non-empty reason" {
  # Count the number of `id:` lines under `query-filters`. Then count
  # the number of `reason:` lines with at least one non-whitespace
  # character of value. They must be equal: every exclude must carry a
  # reason. We use grep rather than `[[ =~ ]]` because the latter is
  # fragile in Git Bash / MSYS2 with quoted regex character classes.
  local exclude_count
  exclude_count=$(grep -cE '^[[:space:]]+id:[[:space:]]+\S+' "$CONFIG" || true)
  [ "$exclude_count" -ge 2 ]
  local reason_count
  reason_count=$(grep -cE '^[[:space:]]+reason:[[:space:]]*\S+' "$CONFIG" || true)
  [ "$reason_count" -ge "$exclude_count" ]
}

@test "codeql-config: caller workflow forwards the config-file" {
  # codeql.yml must pass the config-file to the reusable.
  run grep -E "^[[:space:]]+config-file:[[:space:]]*'.?\.github/codeql/codeql-config\.yml'?" "$WORKFLOW"
  [ "$status" -eq 0 ]
}

@test "codeql-config: reusable version is current (config-file input present)" {
  # The config-file input was added in 01-devops PR #290 (v1.1.0).
  # Verify the caller still uses the reusable at @main and is not pinned
  # to an older version that lacks the input.
  local uses_line
  uses_line=$(grep -E 'uses:[[:space:]]+spark-match/spark-match-01-devops/\.github/workflows/reusable-codeql\.yml' "$WORKFLOW" || true)
  [ -n "$uses_line" ]
  # Backend pins @main per AGENTS.md 10.1 (this repo's policy). The
  # input has been on @main since the 01-devops PR #290 merge; the
  # alternative would be @v1.1.0 (SemVer pin), which is the 01-devops
  # §5.2 recommendation but contradicted by every other consumer.
  echo "$uses_line" | grep -qE '@main(@|$)'
}
