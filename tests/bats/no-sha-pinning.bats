#!/usr/bin/env bats
# SPDX-License-Identifier: Apache-2.0
# Copyright (C) 2026 Spark Match
# =============================================================================
# no-sha-pinning.bats - global guard against SHA-pinned third-party actions
# =============================================================================
# Policy (AGENTS.md 12.1): workflows must NOT pin third-party actions by
# 40-char commit SHA. Floating tags (@vN, @main, @2) are the canonical
# form. SHA-pinning trades convenience for a real supply-chain hazard:
#   - the pin doesn't update on upstream fixes (incl. security patches)
#   - the pin survives a maintainer repo deletion, leaving stale SHA refs
#     in our .github/workflows/ that fail at run time with cryptic
#     "Unable to resolve action ... repository or version not found"
#   - the cost of floating tags is minimal: Dependabot still proposes
#     bumps to the latest @vN release
#
# Self-actions (spark-match/spark-match-01-devops/.github/actions/...) are
# allowed at @main or pinned-to-SHA; this guard excludes them.
#
# Adapted from spark-match-01-devops/tests/bats/no-sha-pinning.bats (GPL-3.0).
# Same intent, same implementation, target repo is this one.
# =============================================================================

setup() {
  REPO_ROOT="$(git rev-parse --show-toplevel)"
  WORKFLOWS_DIR="${REPO_ROOT}/.github/workflows"
}

@test "no-sha-pinning: no third-party action is SHA-pinned in any workflow" {
  # Scan every workflow file; flag any `uses:` line that points at a
  # third-party action pinned to a 40-char hex SHA. Self-actions (calls
  # to reusable-*.yml inside the same workspace) are excluded via the
  # owner/repo filter.
  local offenders=()
  local f
  for f in "${WORKFLOWS_DIR}"/*.yml "${WORKFLOWS_DIR}"/*.yaml; do
    [[ -f "$f" ]] || continue
    while IFS= read -r line; do
      # Skip comments and lines without an action reference.
      [[ "$line" =~ ^[[:space:]]*# ]] && continue
      [[ "$line" =~ uses: ]] || continue
      local ref
      ref=$(echo "$line" | grep -oE '[A-Za-z0-9._-]+/[A-Za-z0-9._-]+@[A-Za-z0-9._/-]+' | head -n1)
      [[ -z "$ref" ]] && continue
      # Skip self-actions: calls to *this* repo's workflows (a local
      # `./.github/workflows/reusable-*.yml` reference is allowed at
      # any ref). The cross-repo self-action is spark-match-01-devops
      # reusables, which we pin at @main by policy (AGENTS.md 10.1).
      case "$ref" in
        ./.*) continue ;;
        spark-match/spark-match-03-backend/*) continue ;;
      esac
      local after_at="${ref##*@}"
      if [[ "$after_at" =~ ^[0-9a-f]{40}$ ]]; then
        local line_num
        line_num=$(grep -nF "$ref" "$f" | head -n1 | cut -d: -f1)
        offenders+=("$f:$line_num: $ref")
      fi
    done < "$f"
  done
  if [[ ${#offenders[@]} -gt 0 ]]; then
    echo "# SHA-pinned third-party actions (forbidden by policy):"
    printf '  %s\n' "${offenders[@]}"
    return 1
  fi
}

@test "no-sha-pinning: no SHA pins remain anywhere in .github/workflows/ (incl. self-actions)" {
  # Strict variant: forbid SHA pins entirely. Self-actions also follow
  # the `@main` rule per AGENTS.md 12.1. SHA-pinning them is a regression
  # to the old style.
  local offenders=()
  local f
  for f in "${WORKFLOWS_DIR}"/*.yml "${WORKFLOWS_DIR}"/*.yaml; do
    [[ -f "$f" ]] || continue
    local matches
    matches=$(grep -nE '@[0-9a-f]{40}' "$f" | grep -vE '^[[:space:]]*[0-9]+:#' || true)
    if [[ -n "$matches" ]]; then
      while IFS= read -r m; do
        offenders+=("$f: $m")
      done <<< "$matches"
    fi
  done
  if [[ ${#offenders[@]} -gt 0 ]]; then
    echo "# SHA pins in .github/workflows/ (forbidden):"
    printf '  %s\n' "${offenders[@]}"
    return 1
  fi
}

@test "no-sha-pinning: AGENTS.md reflects the no-SHA-pinning policy" {
  # Regression guard: if someone re-introduces the "Pin by SHA" rule
  # in AGENTS.md, the bats tests would no longer enforce it. Catch the
  # doc regression at the same place as the code regression.
  run grep -E 'Pin by SHA' "${REPO_ROOT}/AGENTS.md"
  if [[ "$status" -eq 0 ]]; then
    echo "# AGENTS.md still mentions 'Pin by SHA' - update the policy section."
    return 1
  fi
}
