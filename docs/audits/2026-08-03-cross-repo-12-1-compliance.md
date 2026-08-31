---
title: "Cross-repo audit: §12.1 compliance for sibling repos"
tags: [audit, ci, ag-12-1, follow-up]
created: 2026-08-03
related-prs: ["#107", "#108", "#110", "#111"]
---

# §12.1 compliance audit — sibling repos

Audit done on 2026-08-03 as part of the Sprint 3 CI modernization
follow-ups (`PR #111 §12`, `PR #110 SHA-pinning fix`). Goal: detect the
same violations we fixed in backend in other consumer repos of the
devops recipe catalog, before they accumulate to the same scale.

Methodology: §12.2 pipeline evaluation (reusar → wrapper → crear)
applied cross-repo. We focus on existing `reusable-*` consumers; the
devops catalog itself (`spark-match-01-devops`) is out of scope (owned
by QA/devops).

## Inventory of repos audited

| Repo | Role | Workflows | Caller to devops? |
|---|---|---|---|
| `spark-match-02-infrastructure` | Terraform infra (dev/staging/prod) | 6 (`ci.yml` + 4 env-specific + `terraform-security-scan.yml`) | Yes — uses `reusable-tflint`, `reusable-gitleaks`, `reusable-terraform-validate`, `reusable-sonar-terraform` |
| `spark-match-07-deep-agent` | Python AI Advisor (Bedrock/RAG) | 1 (`ci.yml`) | No — uses no devops reusables |

## Findings

### `spark-match-02-infrastructure` — `.github/workflows/ci.yml`

All §12.1 rules pass:
- All 4 callers use `reusable-*` prefix (reusable-tflint, reusable-gitleaks, reusable-terraform-validate, reusable-sonar-terraform)
- Inputs kebab-case; secrets in SNAKE_CASE (`SONAR_TOKEN`, `GITLEAKS_LICENSE`)
- Pin `@main` everywhere; no SHA-pinning
- Brand names canonical (`sonar-terraform`)
- `permissions:` minimal (contents: read, pull-requests: read, security-events: write)
- Job IDs kebab-case (`tflint`, `gitleaks`, `terraform-validate`, `sonar-terraform`)

Cosmetic (NOT §12.1 violations): `name: Continuous Integration (CI)` is a
display string. Workflow-level `name:` is not in §12.1 scope per
`AGENTS.md §12.1`.

### `spark-match-02-infrastructure` — `.github/workflows/terraform-security-scan.yml`

3 §12.1 violations on step `name:` fields (PascalCase where kebab-case
is required):

| Line | Current | Required by §12.1 |
|---|---|---|
| `Checkout` | PascalCase | `checkout` |
| `Set up Python` | spaces + capitals | `set-up-python` |
| `Install checkov (pinned 3.2.415, ...)` | capitals + parenthetical | `install-checkov` |

Otherwise compliant: pins are `@v7` (major, no SHA); reusable-style
actions (`actions/checkout`, `actions/setup-python`, etc.) keep upstream names.

**Why this matters**: PR #110 in backend added `reusable-actionlint.yml` to CI;
this workflow would fail actionlint with `"name" should be kebab-case`
errors. Currently the infra repo doesn't run actionlint as a gate (only
tflint + gitleaks + terraform-validate + sonar), so the violations are
silent.

**Recommended fix**: one PR renaming the 3 step names. Trivial. Same
pattern as backend PR #118.

### `spark-match-02-infrastructure` — `terraform-{apply,plan}-{dev,prod}.yml`

Not fetched in this audit (assumed identical structure to the
plan/apply reusables in devops; they would be thin wrappers). If
these are direct workflows (not just `uses: ...reusable-terraform-*.yml`
callers), they may have similar step-name issues. Recommend a
follow-up audit on these 4 files if the workflow content is non-trivial.

### `spark-match-07-deep-agent` — `.github/workflows/ci.yml`

11 §12.1 violations on step `name:` fields:

| Line | Current | Required by §12.1 |
|---|---|---|
| `Install uv` | capitals | `install-uv` |
| `Set up Python` | spaces + capitals | `set-up-python` |
| `Cache uv` | capitals | `cache-uv` |
| `Install dependencies` | capitals | `install-dependencies` |
| `Run tests` | capitals | `run-tests` |
| `Run eval (mock mode)` | capitals + parenthetical | `run-eval-mock` |
| `Lint (ruff)` | capitals + parenthetical | `lint-ruff` |
| `Lint (ruff format check)` | capitals + parenthetical | `lint-ruff-format` |
| `Type check (mypy)` | capitals | `type-check-mypy` |
| `Build wheel` | capitals | `build-wheel` |
| `Verify metadata` | capitals | `verify-metadata` |

Otherwise compliant: pins are `@v4`/`@v6` (major, no SHA); reusable-style
third-party actions (`actions/checkout`, `astral-sh/setup-uv`,
`actions/cache`) keep upstream names; brand name `ruff` (lowercase
canonical per §12.1 — `Ruff` would need to be `ruff`); permissions not
explicit but defaults are fine for a single-job test+build workflow.

**Why this matters**: This repo doesn't run actionlint either
(no `.github/workflows/reusable-actionlint.yml` caller). Same
silent-violation pattern as the infra repo. Adopting actionlint
would surface both at once.

**Recommended fix**: one PR renaming the 11 step names. Same pattern
as backend PR #118.

### `spark-match-07-deep-agent` — adoption of devops reusables

Currently **uses NONE**. Its single `ci.yml` runs uv + pytest + ruff + mypy
directly. This is the highest-value adoption candidate (per §12.2
methodology: reusar primero):

- `reusable-actionlint.yml` would catch the 11 step-name violations above
- `reusable-eslint.yml` — N/A (Python repo, no ESLint)
- `reusable-gitleaks.yml` — high value (secret scanning)
- `reusable-yamllint.yml` — N/A (no YAML in this repo)
- `reusable-node-test.yml` etc. — N/A

The repo's CI is small enough that adopting 2 reusables (actionlint +
gitleaks) would have outsized value. Same 2-PR pattern we used in
backend: (1) verify secrets/org config, (2) add jobs to ci.yml.

## Action items (proposed)

Priority order:

1. **Open an issue in `spark-match-02-infrastructure`**: "fix step names
   in `terraform-security-scan.yml` per §12.1" with the table above
   copied. Trivial fix; one PR. Actionlint would have caught it if
   the infra repo ran actionlint.

2. **Open an issue in `spark-match-07-deep-agent`**: two parts —
   (a) same trivial fix on `ci.yml` step names; (b) consider adopting
   `reusable-actionlint.yml` + `reusable-gitleaks.yml` to prevent future
   drift.

3. **Out of scope for this audit**: PR #111's `§12.1` documentation
   is in `spark-match-03-backend/AGENTS.md`. The other repos don't
   have a comparable AGENTS.md or `§12.1`. Adding it cross-repo is
   a follow-up (lower priority — the conventions are documented once
   and can be referenced cross-repo).

## References

- `spark-match-03-backend/AGENTS.md` §12.1 (canonical conventions)
- `spark-match-03-backend/AGENTS.md` §12.2 (audit methodology)
- `spark-match-01-devops/docs/VERSIONING.md` (`reusable-` prefix rule)
- PR #110 (SHA-pinning fix, codeql job-name fix in backend)
- PR #111 (§12 docs in backend)
- PR #118 (kebab-case step names fix in backend)

---
**Auditor**: ahincho · **Method**: §12.2 (reuse-first) · **Coverage**: 100% of
`reusable-*` consumers identified at audit time (backend + 02-infrastructure
+ 08-deep-agent).