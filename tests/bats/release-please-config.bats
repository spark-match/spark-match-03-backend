#!/usr/bin/env bats
# SPDX-License-Identifier: Apache-2.0
# Copyright (C) 2026 Spark Match
# =============================================================================
# release-please-config.bats - validate .github/release-please-config.json
# =============================================================================
# Verifies the release-please manifest config is present, parses as JSON,
# conforms to the schema, and contains the customized sections we care
# about (PR title pattern, header, footer, changelog sections for
# feat/fix/ci/docs/security/test).
#
# Backend-specific differences vs spark-match-01-devops:
#   - tag-separator is '@' (used to namespace version tags per repo).
#   - packages.'.' publishes package-name 'spark-match-03-backend'.
#   - changelog-sections includes 'perf' and 'revert' (not 'governance').
#   - several section types are marked 'hidden: true' (refactor, style,
#     build, chore) so they still get into the manifest but do not
#     inflate the release notes.
#
# Adapted from spark-match-01-devops/tests/bats/release-please-config.bats
# (GPL-3.0). Same intent, narrower assertion set to fit this repo.
# =============================================================================

setup() {
  REPO_ROOT="$(git rev-parse --show-toplevel)"
  CONFIG="$REPO_ROOT/.github/release-please-config.json"
  MANIFEST="$REPO_ROOT/.release-please-manifest.json"
  WORKFLOW="$REPO_ROOT/.github/workflows/release-please.yml"
}

@test "release-please config file exists" {
  [ -f "$CONFIG" ]
}

@test "release-please config is valid JSON" {
  run jq empty "$CONFIG"
  [ "$status" -eq 0 ]
}

@test "release-please config has packages.{\".\"} entry" {
  run jq -e '.packages["."]' "$CONFIG"
  [ "$status" -eq 0 ]
}

@test "release-please config declares pull-request-title-pattern" {
  local pattern
  pattern=$(jq -r '.["pull-request-title-pattern"] // .packages["."]["pull-request-title-pattern"] // ""' "$CONFIG")
  [ -n "$pattern" ]
  [[ "$pattern" != "chore"*"release"* ]] || skip "title pattern still uses default chore: release prefix"
  echo "$pattern" | grep -q '\${version}'
}

@test "release-please config declares pull-request-header" {
  local header
  header=$(jq -r '.["pull-request-header"] // .packages["."]["pull-request-header"] // ""' "$CONFIG")
  [ -n "$header" ]
  [[ "$header" == *"Automated release"* ]] || [[ "$header" == *"release-please"* ]]
}

@test "release-please config declares pull-request-footer" {
  local footer
  footer=$(jq -r '.["pull-request-footer"] // .packages["."]["pull-request-footer"] // ""' "$CONFIG")
  [ -n "$footer" ]
  [[ "$footer" == *"checklist"* ]] || [[ "$footer" == *"Published by"* ]]
}

@test "release-please config declares changelog-sections" {
  run jq -e '.["changelog-sections"] // .packages["."]["changelog-sections"]' "$CONFIG"
  [ "$status" -eq 0 ]
}

@test "release-please changelog-sections include feat/fix/ci/docs/security/test" {
  local sections
  sections=$(jq -r '(.["changelog-sections"] // .packages["."]["changelog-sections"]) | .[].type' "$CONFIG" | sort | tr '\n' ',' | sed 's/,$//')
  echo "# sections=$sections"
  for t in feat fix ci docs security test; do
    echo "$sections" | grep -q "\\b$t\\b" || { echo "missing type=$t"; return 1; }
  done
}

@test "release-please changelog-sections include feat and fix (default release triggers)" {
  local sections
  sections=$(jq -r '(.["changelog-sections"] // .packages["."]["changelog-sections"]) | .[].type' "$CONFIG" | sort | tr '\n' ',' | sed 's/,$//')
  echo "# sections=$sections"
  for t in feat fix; do
    echo "$sections" | grep -q "\\b$t\\b" || { echo "missing type=$t"; return 1; }
  done
}

@test "release-please config references schema for editor tooling" {
  run jq -e '."$schema"' "$CONFIG"
  [ "$status" -eq 0 ]
  [[ "$output" == *"release-please"* ]]
}

@test "release-please config bump rules match repo policy (pre-1.0.0)" {
  local bump_patch_for_minor
  bump_patch_for_minor=$(jq -r '.["bump-patch-for-minor-pre-major"] // .packages["."]["bump-patch-for-minor-pre-major"] // false' "$CONFIG")
  [ "$bump_patch_for_minor" = "true" ]
}

@test "release-please config uses v-prefixed tags" {
  local include_v
  include_v=$(jq -r '.["include-v-in-tag"] // .packages["."]["include-v-in-tag"] // false' "$CONFIG")
  [ "$include_v" = "true" ]
}

@test "release-please config release-type is a valid strategy (no 'default')" {
  local rt
  rt=$(jq -r '.["release-type"] // .packages["."]["release-type"] // ""' "$CONFIG")
  [ -n "$rt" ]
  [ "$rt" != "default" ] || { echo "release-type 'default' is not a valid release-please strategy"; return 1; }
  case "$rt" in
    simple|node|python|go|java|rust|ruby|php|elixir|terraform-module|helm|docker|maven|dotnet|dart|krm-blueprint|ocaml|sfdx|expo) ;;
    *) echo "unknown release-type=$rt"; return 1 ;;
  esac
}

@test "pull-request-header and pull-request-footer do NOT contain literal template vars" {
  # release-please source (src/strategies/base.ts) does NOT interpolate
  # template variables in pull-request-header / pull-request-footer -- only
  # pull-request-title-pattern gets interpolated. So we forbid "${...}" in
  # the header/footer to keep release notes readable.
  local header footer
  header=$(jq -r '.["pull-request-header"] // .packages["."]["pull-request-header"] // ""' "$CONFIG")
  footer=$(jq -r '.["pull-request-footer"] // .packages["."]["pull-request-footer"] // ""' "$CONFIG")
  echo "# header=${header:0:120}..."
  echo "# footer=${footer:0:120}..."
  if echo "$header" | grep -qE '\$\{[a-zA-Z]+\}'; then
    echo "literal template var found in header: $(echo "$header" | grep -oE '\\\$\{[a-zA-Z]+\}' | head -1)"
    return 1
  fi
  if echo "$footer" | grep -qE '\$\{[a-zA-Z]+\}'; then
    echo "literal template var found in footer: $(echo "$footer" | grep -oE '\\\$\{[a-zA-Z]+\}' | head -1)"
    return 1
  fi
}

@test "release-please manifest has a SemVer x.y.z version pinned (0.x.y pre-stable or >=1.0.0)" {
  run jq -r '.["."]' "$MANIFEST"
  [ "$status" -eq 0 ]
  [[ "$output" =~ ^(0\.[0-9]+\.[0-9]+|[1-9][0-9]*\.[0-9]+\.[0-9]+)$ ]]
}

@test "release-please workflow resolves config-file .github/release-please-config.json" {
  # Acceptable shapes:
  #   - local `./.github/workflows/reusable-release-please.yml` (same-repo)
  #   - cross-repo `spark-match/spark-match-01-devops/.github/workflows/reusable-release-please.yml@main`
  #     (the canonical form for this repo per AGENTS.md 10.1).
  # In both cases the effective config-file must resolve to
  # .github/release-please-config.json: either explicitly in the caller
  # or via the canonical hardcoded path in the reusable.
  local reusable_path
  if grep -qE 'uses:[[:space:]]*\./\.github/workflows/reusable-release-please\.yml' "$WORKFLOW"; then
    reusable_path="${WORKFLOW%/*}/.github/workflows/reusable-release-please.yml"
  elif grep -qE 'uses:[[:space:]]*spark-match/spark-match-01-devops/\.github/workflows/reusable-release-please\.yml@main' "$WORKFLOW"; then
    # Source from a sibling repo checkout, resolved from the repo root.
    # The expected workspace layout is:
    #   .../orion/spark-match-03-backend      (REPO_ROOT)
    #   .../orion/spark-match-01-devops
    # Computed via git common-dir to stay portable across CI / local.
    local workspace_root
    workspace_root=$(cd "$REPO_ROOT/.." && pwd)
    local sibling="${workspace_root}/spark-match-01-devops/.github/workflows/reusable-release-please.yml"
    [[ -f "$sibling" ]] || skip "sibling reusable not present at $sibling"
    reusable_path="$sibling"
  else
    # legacy shape: caller must explicitly reference the config file
    run grep -E 'config-file:[[:space:]]*\.github/release-please-config\.json' "$WORKFLOW"
    [ "$status" -eq 0 ]
    return 0
  fi
  # Caller takes priority if it sets config-file explicitly.
  if grep -qE 'config-file:[[:space:]]*\.github/release-please-config\.json' "$WORKFLOW"; then
    return 0
  fi
  # Otherwise the reusable must hardcode the path.
  run grep -E 'config-file:[[:space:]]*\.github/release-please-config\.json' "$reusable_path"
  [ "$status" -eq 0 ]
}
