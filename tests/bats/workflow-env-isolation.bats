#!/usr/bin/env bats
# SPDX-License-Identifier: Apache-2.0
# Copyright (C) 2026 Spark Match
# =============================================================================
# workflow-env-isolation.bats - repo-wide regression guards against the
# code-injection anti-pattern that AGENTS.md section 12.1 closes.
#
# Rule: NO `run:` block in any workflow may interpolate ${{ inputs.* }},
# ${{ steps.*.outputs.* }}, or ${{ secrets.* }} directly. Every such
# interpolation must be env-isolated: declare the value under `env:` as
# SCREAMING_SNAKE_CASE, then reference it as ${VAR} in the shell.
#
# Why: GitHub Actions evaluates ${{ }} BEFORE bash sees the shell script.
# If the substituted value contains $(...), backticks, or shell
# metacharacters, bash evaluates them as code. codeql flags caller-input
# versions as 'Code injection' (see alerts 508-517, closed by PR #183).
# Same risk applies to step outputs (lower-severity because the step
# output is repo-controlled, not caller-controlled, but the pattern is
# identical and the fix is identical).
#
# IMPORTANT: this test tracks THREE block states correctly:
#   - in_env: inside `env:` block (lines are INPUT DECLARATIONS, OK)
#   - in_run: inside `run: |` block (lines are SHELL CODE, must be env-isolated)
#   - in_with / if / etc: skip
# A previous version of this test confused env: lines with run: lines,
# producing massive false positives. See PR-cleanup commit message.
#
# Adapted from spark-match-01-devops/tests/bats/workflow-env-isolation.bats
# (GPL-3.0). Same intent, same implementation, target repo is this one.
# =============================================================================

WORKFLOWS_DIR="$BATS_TEST_DIRNAME/../../.github/workflows"

# State machine: track YAML step blocks.
# Returns offender lines (one per line) via the offenders array variable.
# Usage: scan_workflow "$workflow_file" "inputs|steps|secrets"
scan_workflow() {
  local wf="$1"
  local pattern="$2"
  local -a offenders=()
  local in_env=0
  local env_indent=-1
  local in_run=0
  local run_indent=-1
  local line_num=0
  local match
  while IFS= read -r line; do
    line_num=$((line_num + 1))
    [[ "$line" =~ ^[[:space:]]*$ ]] && continue
    if [[ "$line" =~ ^[[:space:]]*# ]]; then continue; fi

    if [[ $in_env -eq 1 ]]; then
      if [[ "$line" =~ ^([[:space:]]+)[A-Za-z_-]+:[[:space:]]*[^:[:space:]] ]]; then
        local ind="${#BASH_REMATCH[1]}"
        if [[ $ind -le $env_indent ]]; then
          in_env=0
          env_indent=-1
        fi
      elif [[ "$line" =~ ^([[:space:]]+)-[[:space:]] ]]; then
        local ind="${#BASH_REMATCH[1]}"
        if [[ $ind -le $env_indent ]]; then
          in_env=0
          env_indent=-1
        fi
      fi
      if [[ $in_env -eq 1 ]]; then
        continue
      fi
    fi

    if [[ $in_run -eq 1 ]]; then
      local is_sibling=0
      if [[ "$line" =~ ^([[:space:]]+)-[[:space:]]name: ]]; then
        is_sibling=1
      elif [[ "$line" =~ ^([[:space:]]+)[a-zA-Z_-]+:[[:space:]]*[^|[:space:]] ]]; then
        local ind="${#BASH_REMATCH[1]}"
        if [[ $ind -le $run_indent ]]; then
          is_sibling=1
        fi
      elif [[ "$line" =~ ^([[:space:]]+)[a-zA-Z_-]+:[[:space:]]*$ ]]; then
        local ind="${#BASH_REMATCH[1]}"
        if [[ $ind -le $run_indent ]]; then
          is_sibling=1
        fi
      fi
      if [[ $is_sibling -eq 1 ]]; then
        in_run=0
        run_indent=-1
      else
        case "$pattern" in
          inputs)
            match='\$\{\{[[:space:]]*inputs\.'
            ;;
          steps)
            match='\$\{\{[[:space:]]*steps\.[a-zA-Z0-9_-]+\.outputs\.'
            ;;
          secrets)
            match='\$\{\{[[:space:]]*secrets\.'
            ;;
          *)
            match='\$\{\{[[:space:]]*(inputs|steps|secrets)\.'
            ;;
        esac
        if [[ "$line" =~ $match ]]; then
          offenders+=("$wf:$line_num: $line")
        fi
        continue
      fi
    fi

    if [[ "$line" =~ ^([[:space:]]+)env:[[:space:]]*$ ]]; then
      in_env=1
      env_indent="${#BASH_REMATCH[1]}"
      continue
    fi
    if [[ "$line" =~ ^([[:space:]]+)run:[[:space:]]*\|[[:space:]]*$ ]]; then
      in_run=1
      run_indent="${#BASH_REMATCH[1]}"
      continue
    fi
  done < "$wf"
  if [[ ${#offenders[@]} -gt 0 ]]; then
    echo "  $wf has ${#offenders[@]} offender(s):"
    printf '    %s\n' "${offenders[@]}"
    return 1
  fi
  return 0
}

# ---------------------------------------------------------------------------
# Tests
# ---------------------------------------------------------------------------

@test "no workflow has \${{ inputs.* }} interpolation inside any run: block" {
  local failed=()
  local wf
  for wf in "$WORKFLOWS_DIR"/*.yml "$WORKFLOWS_DIR"/*.yaml; do
    [[ -f "$wf" ]] || continue
    if ! scan_workflow "$wf" "inputs"; then
      failed+=("$wf")
    fi
  done
  [[ ${#failed[@]} -eq 0 ]]
}

@test "no workflow has \${{ steps.*.outputs.* }} interpolation inside any run: block" {
  local failed=()
  local wf
  for wf in "$WORKFLOWS_DIR"/*.yml "$WORKFLOWS_DIR"/*.yaml; do
    [[ -f "$wf" ]] || continue
    if ! scan_workflow "$wf" "steps"; then
      failed+=("$wf")
    fi
  done
  [[ ${#failed[@]} -eq 0 ]]
}

@test "no workflow has \${{ secrets.* }} interpolation inside any run: block" {
  local failed=()
  local wf
  for wf in "$WORKFLOWS_DIR"/*.yml "$WORKFLOWS_DIR"/*.yaml; do
    [[ -f "$wf" ]] || continue
    if ! scan_workflow "$wf" "secrets"; then
      failed+=("$wf")
    fi
  done
  [[ ${#failed[@]} -eq 0 ]]
}
