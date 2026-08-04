# CI/CD Improvement Plan — spark-match-03-backend

> **Status (2026-08-04):** Draft, pending review. Source: full audit of `.github/workflows/`
> of this repo against `spark-match-01-devops@main` (v1.0.5) reference catalog. Cross-references
> AGENTS.md §13 backlog (B<n>) and adds new items (NB-<n>).
>
> **Scope:** 12 PRs across 6 sprints (Sprint 4 - Sprint 9). Strictly additive: no PR
> bundles more than one item from this plan. Dependencies are explicit.
>
> **Owner:** @ahincho · **Reviewers:** @spark-match/backend-devs (CODEOWNERS).

---

## 1. Inventory snapshot

**Backend CI today (8 jobs, all green on `dev` at 2026-08-04 06:17 UTC):**

| Job | Recipe consumed (`spark-match-01-devops`) |
|---|---|
| `codeql-analyze/setup-parse-languages` | `reusable-codeql.yml` |
| `codeql-analyze/analyze-javascript` | `reusable-codeql.yml` |
| `codeql-analyze/analyze-actions` | `reusable-codeql.yml` |
| `sonar/sonar-typescript-ci` | `reusable-sonar-typescript.yml` |
| `migrations-dry-run/migrations-dry-run-ci` | `reusable-migrations-dry-run.yml` |
| `actionlint/actionlint-ci` | `reusable-actionlint.yml` |
| `eslint/eslint-ci` | `reusable-eslint.yml` |
| `gitleaks/gitleaks-ci` | `reusable-gitleaks.yml` |
| `yamllinks/yamllint-ci` | `reusable-yamllint.yml` |

**Reusables from `01-devops` NOT yet adopted (evaluable):**

| Recipe | Backend use case | Plan PR |
|---|---|---|
| `reusable-node-typecheck.yml` | Dedicated `tsc --noEmit` gate (currently only pre-commit husky and inside sonar install-command) | #131 |
| `reusable-node-test.yml` | Dedicated vitest job (currently inline in sonar test-command) | #132 |
| `reusable-node-build.yml` | Reuse for `build:shared` + `layer:build:all` in deploy | #134 |
| `reusable-commitlint.yml` | PR-side Conventional Commits gate | #133 |
| `reusable-release-please.yml` | Auto release + CHANGELOG (B17) | #135 |
| `reusable-quality.yml` | shellcheck + manifest schema (low value, no shell scripts in src) | not adopted |
| `reusable-latex-*.yml` | not applicable | not adopted |

**Reusables NOT yett callable from this repo** (platform-team dependency):

| Recipe | Missing input | Plan PR |
|---|---|---|
| `reusable-codeql.yml` with `config-file:` | `config-file` input not yet declared in `01-devops` | #138 (blocked on external PR) |

**Security posture (verified 2026-08-04):** 0 open code-scanning alerts, 0 open Dependabot alerts.

---

## 2. Roadmap

```
Sprint 4 (1 wk)      Sprint 5 (1.5 wk)        Sprint 6 (2 wk)        Sprint 7 (2 wk)        Sprint 8 (1.5 wk)         Sprint 9 (1 wk)
[zero-risk hygiene]  [deploy fixes]           [quality gates]        [build + release]      [structural tests]       [perf]
   #125                #128  *                  #131                   #134                   #137                     #140 (skip)
   #126                #129                     #132                   #135                   #138 (#)                 #141
   #127                #130                     #133                   #136                   #139
```

`*` PR #128 is the only PR with real deploy risk. Do it first within Sprint 5.
`(#)` PR #138 is blocked on a platform-team PR in `01-devops` (add `config-file` input).

---

## 3. PRs by sprint

### Sprint 4 — Hygiene & cosmetic fixes (zero risk)

#### PR #125 — `fix(ci): rename yamllinks job to yamllint for AGENTS.md §12.1`

- **Closes:** B25
- **Diff:** 1 line in `.github/workflows/ci.yml`. `yamllinks:` -> `yamllint:` (job id only; display name `yamllint-ci` is already correct).
- **Risk:** none.
- **Verification:** `gh pr checks` enumerates 9 jobs with kebab-case ids.

#### PR #126 — `fix(codeql): sync header comment to actual cron `0 8 * * *``

- **Closes:** B23 (partial — header comment only).
- **Diff:** `.github/workflows/codeql.yml` lines 17-25. Update prose from "weekly Monday 06:17 UTC" to "daily 08:00 UTC".
- **Risk:** none (comment-only).

#### PR #127 — `fix(codeql): correct header doc reference to reusable-codeql.yml@main`

- **Closes:** B23 (final).
- **Diff:** `.github/workflows/codeql.yml` lines 6-7. Replace `codeql.yml@main` reference with `reusable-codeql.yml@main`.
- **Risk:** none (comment-only).

---

### Sprint 5 — Deploy pipeline correctness (one high-risk PR)

#### PR #128 — `fix(deploy): add AWS OIDC credentials config + bump node-version to 24`

- **Closes:** B6 (partial), G1 (CI audit gap).
- **Context:** `deploy.yml` has `id-token: write` permission but never calls `aws-actions/configure-aws-credentials`. `sam deploy` cannot authenticate. Also pins `node-version: 20` while runtime is `nodejs24.x`.
- **Expected diff:**
  ```yaml
  - name: configure-aws-credentials-oidc
    uses: aws-actions/configure-aws-credentials@v4
    with:
      role-to-assume: ${{ vars.AWS_DEPLOY_ROLE_ARN }}
      aws-region: us-east-1
  - name: setup-node-js
    uses: actions/setup-node@v4
    with:
      node-version: '24'
      cache: 'npm'
  ```
- **Pre-flight (mandatory before merge):**
  1. Confirm `spark-match-sam-deploy-{env}` role ARN exists in `spark-match-02-infrastructure/docs/IAM_ROLES.md`.
  2. Create repo var `AWS_DEPLOY_ROLE_ARN` (visibility private) with ARN for `dev`.
  3. Verify trust policy allows `token.actions.githubusercontent.com`.
- **Risk:** medium-high. First time `sam deploy` will run end-to-end.
- **Rollback:** revert PR; `dev` deploys become manual again.

#### PR #129 — `fix(samconfig): add dev and staging envs to support --config-env`

- **Closes:** B3.
- **Context:** `samconfig.toml` only defines `[default]` and `[prod]`. `--config-env dev` and `--config-env staging` fail with "config_env not found".
- **Expected diff:** add `[dev]` and `[staging]` blocks symmetric to `[prod]` with appropriate `parameter_overrides` (LogRetention, s3_bucket).
- **Risk:** low (config only, no deploy until #128 lands).

#### PR #130 — `chore(envs): declare dev/staging/prod GitHub Environments`

- **Closes:** NB-1.
- **Context:** `deploy.yml` consumes `environment: ${{ inputs.environment }}` but no GH Environments are declared. GH Environments must be created before secrets can be gated per-env.
- **Approach:**
  - Protection: `dev` none, `staging` 1 reviewer, `prod` 2 reviewers.
  - Better path: open platform-team ticket against `01-devops` to add `environment_templates` to `governance/repository-governance.json` and let the backend inherit.
- **Risk:** medium (touches governance cross-repo).
- **Block:** should land after PR #128 to avoid orphan definitions.

---

### Sprint 6 — Quality gates (3 PRs, parallelizable)

#### PR #131 — `feat(ci): adopt reusable-node-typecheck.yml as PR gate`

- **Closes:** NB-2.
- **Diff:** add job in `ci.yml`:
  ```yaml
  node-typecheck:
    uses: spark-match/spark-match-01-devops/.github/workflows/reusable-node-typecheck.yml@main
    with:
      environment-name: ci
      node-version: '24'
      typecheck-script: typecheck
  ```
- **Risk:** low. Recipe is Tier 3 (production, consumed by 04-frontend).
- **Benefit:** catches type regressions before sonar (~5 min faster feedback).

#### PR #132 — `feat(ci): adopt reusable-node-test.yml`

- **Closes:** NB-3.
- **Context:** coverage LCOV is produced only inside `sonar` job (line 30 of `ci.yml`). No dedicated "tests passing" gate. If tests fail, sonar reports QG failure with no clear root cause.
- **Approach:** add `node-test` job running `test:ci` (no coverage) to separate concerns. `sonar` keeps producing LCOV for sonarcloud.
- **Risk:** low (additive).

#### PR #133 — `feat(ci): adopt reusable-commitlint.yml`

- **Closes:** B13.
- **Diff:**
  - Create `.commitlintrc.json` (extends `@commitlint/config-conventional`, `header-max-length: 100`).
  - Add `commitlint` job in `ci.yml` (PR-side).
  - Document in AGENTS.md how to use `--no-verify` only for `feat!:` and `(#NN)` (cross-repo contract with 01-devops §5.7).
- **Pre-flight:** audit recent commits (`git log --oneline -50`) for subject patterns that would fail; fix or revert before activating.
- **Risk:** low-medium. Will surface latent issues in PR history.

---

### Sprint 7 — Build & release automation (3 PRs)

#### PR #134 — `refactor(deploy): adopt reusable-node-build.yml for shared + layers`

- **Closes:** NB-4.
- **Diff:** replace 3 lines in `deploy.yml` with one call to `reusable-node-build.yml`:
  ```yaml
  - name: setup-node-build
    uses: spark-match/spark-match-01-devops/.github/workflows/reusable-node-build.yml@main
    with:
      environment-name: ${{ inputs.environment }}
      node-version: '24'
      pre-build-script: 'build:shared'
      build-script: 'layer:build:all'
  ```
- **Risk:** low. Drops `setup-node@v4` to `setup-node@v7` (recipe-internal).

#### PR #135 — `feat(ci): adopt reusable-release-please.yml`

- **Closes:** B17.
- **Prerequisites (manual, admin UI):**
  1. Enable `Allow auto-merge` in repo settings.
  2. Add `dependabot[bot]` to `bypass_actors` of the ruleset.
- **Diff:**
  - Create `.github/workflows/release-please.yml` (caller of `reusable-release-please.yml`).
  - Create `.github/release-please-config.json` (Simple release-type, kebab-case scopes, `tag-separator: @`).
- **Org secret verification:** `RELEASE_PLEASE_APP_ID` and `RELEASE_PLEASE_APP_PRIVATE_KEY` are already org-level visibility `all` (verified 2026-08-04).
- **Risk:** medium. First push to `main` will auto-cut a `release 1.0.0` PR. Manual merge required.

#### PR #136 — `chore(ci): full CODEOWNERS coverage for CI + governance paths`

- **Closes:** B20.
- **Diff:** audit `.github/CODEOWNERS` and add missing paths:
  - `package.json`, `package-lock.json`
  - `tsconfig*.json`, `vitest.config.mts`, `eslint.config.mjs`
  - `AGENTS.md`
  - `.commitlintrc.json`, `.release-please-manifest.json` (added by PR #133/#135)
  - `CHANGELOG.md`, `docs/CHANGELOG.md` (added by PR #135/#139)
  - `CONTRIBUTING.md`, `SECURITY.md`, `LICENSE` (added by PR #139)
- **Risk:** low (governance-only).

---

### Sprint 8 — Structural tests & governance docs (3 PRs)

#### PR #137 — `test(ci): add tests/bats/ structural guards for own ci.yml`

- **Closes:** NB-5.
- **Adopt** a subset of `01-devops/tests/bats/` adapted:
  - `no-sha-pinning.bats` — no 40-char SHAs in `uses:`.
  - `workflow-env-isolation.bats` — no direct `${{ inputs.* }}` / `${{ secrets.* }}` in `run:` blocks.
  - `reusable-pin-main.bats` — reusables from `01-devops` pinned to `@main` (not `@vX.Y.Z`).
  - `dependabot-config.bats` — schema-validate `.github/dependabot.yml`.
- **Risk:** low. Tests purely structural.
- **Benefit:** prevents regression of conventions in AGENTS.md §12.1.

#### PR #138 — `fix(codeql): add codeql-config.yml once reusable exposes config-file input`

- **Closes:** B26 (final).
- **External dependency:** `01-devops` PR adding `config-file:` input to `reusable-codeql.yml`. This PR in backend is blocked until that lands.
- **After unblock:**
  - Create `.github/codeql/codeql-config.yml` mirroring `01-devops/.github/codeql/codeql-config.yml` (exclude `actions/unpinned-tag` + `js/actions/unpinned-3rd-party-action`).
  - Modify `ci.yml` `codeql` job to pass `config-file: '.github/codeql/codeql-config.yml'`.
- **Risk:** low (exclusions only).

#### PR #139 — `chore(repo): add CONTRIBUTING.md, SECURITY.md, LICENSE, CHANGELOG.md`

- **Closes:** B18.
- **Diff:** create 4 files at repo root:
  - `LICENSE` (decide between Apache-2.0 or MIT — Apache-2.0 matches `01-devops`; recommend same).
  - `CONTRIBUTING.md` (fork of `01-devops/CONTRIBUTING.md` with backend-specific adaptations).
  - `SECURITY.md` (disclosure process + SLA).
  - `CHANGELOG.md` (auto-managed by release-please from PR #135).
- **Risk:** none (documentation-only).

---

### Sprint 9 — Self-dogfooding & perf (1 PR executed, 1 evaluated)

#### PR #140 — `feat(ci): self-dogfooding ci-dogfood.yml via ./ reusable consumers` (EVALUATE, likely skip)

- **Closes:** NB-6.
- **Context:** `01-devops` dogfoods its own reusables via `./.github/workflows/reusable-*.yml`. Backend does not.
- **Trade-off:** adds 3-5 redundant jobs to CI; only valuable if backend starts publishing own reusables (e.g. for other contexts).
- **Decision:** skip with ADR-019 documenting why.

#### PR #141 — `perf(ci): add paths filter to ci.yml for non-CI docs changes`

- **Closes:** NB-7.
- **Context:** `ci.yml` runs on every push regardless of path. PRs that only change `docs/`, `README.md`, `AGENTS.md` spend 9 jobs unnecessarily.
- **Expected diff:**
  ```yaml
  on:
    pull_request:
      branches: [main, dev]
      paths:
        - 'contexts/**'
        - 'shared/**'
        - 'layers/**'
        - 'scripts/**'
        - 'migrations/**'
        - 'template.yaml'
        - 'contexts/**/template.yaml'
        - 'package.json'
        - 'package-lock.json'
        - 'tsconfig*.json'
        - 'vitest.config.mts'
        - 'eslint.config.mjs'
        - '.github/**'
    push:
      branches: [main, dev]
  ```
- **Risk:** low. `codeql.yml` and `deploy.yml` keep open triggers.

---

## 4. Cross-repo dependencies (not in this repo)

| Item | Repo | Type | Blocks |
|---|---|---|---|
| `reusable-codeql.yml` exposes `config-file` input | `01-devops` | platform-team PR | #138 |
| `RELEASE_PLEASE_APP_ID/PRIVATE_KEY` org secrets `all` | `01-devops` org | verified present | #135 |
| `GITLEAKS_LICENSE` in Dependabot context | this repo settings | manual UI step | continuous |
| `environment_templates` in governance manifest | `01-devops` | platform-team PR | #130 |
| `spark-match-sam-deploy-{env}` role ARN | `02-infrastructure` | documentation lookup | #128 |
| `Allow auto-merge` repo setting | this repo | manual UI step | #135 |
| `dependabot[bot]` in ruleset bypass_actors | this repo ruleset | manual UI step | #135 |

---

## 5. Files touched (accumulated)

| File | PRs |
|---|---|
| `.github/workflows/ci.yml` | #125, #131, #132, #133, #138, #141 |
| `.github/workflows/codeql.yml` | #126, #127, #138 |
| `.github/workflows/deploy.yml` | #128, #134 |
| `.github/workflows/release-please.yml` (new) | #135 |
| `.github/workflows/ci-dogfood.yml` (new, optional) | #140 |
| `.github/CODEOWNERS` | #136 |
| `.github/release-please-config.json` (new) | #135 |
| `.github/codeql/codeql-config.yml` (new) | #138 |
| `.commitlintrc.json` (new) | #133 |
| `.release-please-manifest.json` (new) | #135 |
| `samconfig.toml` | #129 |
| `CONTRIBUTING.md`, `SECURITY.md`, `LICENSE`, `CHANGELOG.md` (new) | #139 |
| `tests/bats/*.bats` (new) | #137 |
| `docs/ci-cd-improvement-plan.md` (this file) | - |
| `AGENTS.md` | #133 (commitlint docs section) |
| `docs/adr/019-...` (new, optional) | #140 (rationale for skipping self-dogfooding) |

---

## 6. Success metrics

| KPI | Today | Target |
|---|---|---|
| CI jobs per PR | 9 | 11 (typecheck + node-test) |
| CI time per PR | ~6-8 min | ~7-9 min |
| Bats structural tests | 0 | 4 |
| Open security alerts | 0 | 0 (maintained) |
| Conventional Commits enforced in CI | 0 (manual) | 100% (PR-side gate) |
| Releases | manual | auto via release-please |
| Deploy | manual + broken | manual + fixed (post-#128-#130) |
| Governance docs at root | 0/4 | 4/4 |
| CODEOWNERS coverage | partial | full |
| CI minutes wasted on docs PRs | ~30% | ~0% |

---

## 7. Global risks

1. **PR #128** is the only PR that can break deploy. Pre-flight: confirm role ARN + trust policy.
2. **PR #135** will auto-cut a `release 1.0.0` PR on first push to `main`. Have `CHANGELOG.md` ready, manual merge.
3. **PR #141** paths filter must be audited before merge to avoid skipping CI on critical changes.
4. **PR #133** commitlint may surface latent PR-history issues. Audit recent commits first.
5. **Cross-repo PRs** against `01-devops` (codeql-config input) depend on a different team. Set realistic dates.

---

## 8. Quick wins (no PR required)

- [ ] Enable `Allow auto-merge` in repo settings (admin UI; gates PR #135).
- [ ] Assign `GITLEAKS_LICENSE` to Dependabot context (admin UI; closes Dependabot limitation noted in `01-devops/.github/dependabot.yml`).
- [ ] Add `dependabot[bot]` to `bypass_actors` of the ruleset (admin UI; gates PR #135).

---

## 9. Execution order

```
1. Sprint 4 (cosmetic, parallel):      #125, #126, #127
2. PR #128 (deploy OIDC) — first in Sprint 5, validates everything else
3. PR #129 (samconfig envs) — gates on #128
4. PR #130 (GH envs) — gates on #128-#129
5. Sprint 6 (parallel):                #131, #132, #133
6. Sprint 7 (parallel):                #134, #135, #136
7. Sprint 8 (parallel):                #137, #139; #138 when 01-devops merges
8. PR #141 (paths filter) — last, after validating everything else
9. PR #140 (skip with ADR-019)
```

---

## 10. Out of scope (recorded but not addressed)

| Gap | Why not addressed | Owner |
|---|---|---|
| B7 — version drift `zod`/`kysely`/`vitest` root vs layer | separate dependencies review PR | @ahincho (Sprint 10+) |
| B16 — `statusChecks: []` in governance manifest | platform-team-owned (§11) | devops |
| B19 — ESLint without `parserOptions.project` | behavior change risk; new findings | decision pending |
| B22 — README links rotos | docs PR | separate |
| B24 — ADR-019 number not used | trivial | when first new ADR after #018 |

---

## 11. References

- `spark-match-01-devops/AGENTS.md` §5.1 (naming), §5.2 (reusable pattern), §13 (lessons learned).
- `spark-match-01-devops/docs/CACHE.md` — cache-key convention.
- `spark-match-01-devops/docs/VERSIONING.md` — single-main model rationale.
- This repo `AGENTS.md` §13 backlog (B<n>).
- SonarCloud QG `Spark Match Way` (id 157178).
