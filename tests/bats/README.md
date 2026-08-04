# bats structural tests

This directory contains `bats-core` regression-guard tests for the
backend's CI/CD configuration. They are analogous to (and adapted
from) the structural tests in `spark-match-01-devops/tests/bats/`.

## What is bats

Bats is a TAP-compliant testing framework for Bash. It is used here
to assert that workflow files, dependabot config, and release-please
config remain valid and conform to the documented policy.

See <https://github.com/bats-core/bats-core> for the framework.

## Files

| File | Asserts |
|---|---|
| `no-sha-pinning.bats` | third-party actions are not pinned by 40-char hex SHA (AGENTS.md 12.1) |
| `workflow-env-isolation.bats` | no `${{ inputs.* / steps.*.outputs.* / secrets.* }}` interpolation inside any `run:` block (AGENTS.md 12.1) |
| `release-please-config.bats` | `.github/release-please-config.json` is valid, schema-valid, declares the expected changelog sections, and the caller workflow resolves `config-file: .github/release-please-config.json` |
| `run.sh` | invokes bats on every *.bats file in this directory |

## Running locally

```bash
# Debian/Ubuntu
sudo apt-get install -y bats

# macOS
brew install bats-core

# Windows (Git Bash)
# bats-core is available at C:\Users\Angel\.local\bin\bats on this
# developer machine; the `run.sh` script invokes the `bats` binary
# from PATH so install it in your shell's PATH.
```

Then from the repo root:

```bash
./tests/bats/run.sh
```

Expected output: 22 tests pass across 3 files (3 + 3 + 16).

## Running in CI

This backend does not currently run the bats tests in CI. The
equivalent checks in `spark-match-01-devops` are run via the
composite action `spark-match/spark-match-01-devops/.github/actions/bats-runner@main`.
Adopting the same composite is tracked in the repo backlog
(NB-5 / NB-6 / ci-cd-improvement-plan.md).

## Portability notes

The tests are POSIX shell + bats-core. They do not depend on the
host's package manager or git topology for any operation other than
identifying the repo root (`git rev-parse --show-toplevel`) and the
release-please caller workflow location. The cross-repo
`release-please-config.bats` test 16 reads from a sibling checkout at
`<workspace>/spark-match-01-devops/.github/workflows/reusable-release-please.yml`
and skips gracefully if absent.

## Adapted from upstream

Three upstream tests were chosen because they are portable and
target policies this repo shares with `spark-match-01-devops`:

1. `no-sha-pinning.bats` (adapted). The self-action filter is
   narrowed to `spark-match/spark-match-03-backend/*` and `./` local
   references, because this repo has no `actions/` directory.
2. `workflow-env-isolation.bats` (verbatim). The state machine is
   identical to upstream and works on any workflow file.
3. `release-please-config.bats` (adapted). The changelog-sections
   assertion is narrowed to `feat/fix/ci/docs/security/test` (the
   sections this repo actually uses upstream uses `governance`
   instead of `perf`/`revert`).
4. The `dependabot-config.bats` from upstream was NOT ported because
   backend's dependabot uses `target-branch: dev` and a two-ecosystem
   layout (npm + github-actions) that does not match the upstream
   single-ecosystem assertions. Tracing the upstream tests against
   this repo's dependabot would require either a custom test or
   removing dependencies on the precise group/cron shape.
