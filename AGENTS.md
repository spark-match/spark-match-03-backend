# AGENTS.md — Spark Match Backend (spark-match-03-backend)

> Working agreement for AI agents (and humans) contributing to this repo.
> Last updated: **2026-08-03** — cross-repo audit against `spark-match-01-devops` (`@7913515`, v1.0.0)
> and `spark-match-02-infrastructure` (`@7e588bb`, v1.0.0). Section §12 numbering is preserved
> because sibling repos link to it.

## 0. The 10-second version

1. **Branch off `dev`.** Never commit directly to `dev` or `main`.
2. **Every check must be green before merge.** No exceptions outside §4.5.
3. Before pushing: `npm ci && npm run build:shared && npm run typecheck && npm run lint && npm run test:coverage`.
4. **New file ⇒ new test in the same PR.** Untested new code lowers coverage *and* the QG blocks on `new_coverage < 80`.
5. **0 new code smells.** One MINOR smell is enough to red the gate.
6. Open/keep security alerts (CodeQL, Dependabot) = **P0, merge-blocking** (§6).

---

## 1. Repo at a glance

- **Language:** TypeScript 6 (`strict`, `noUncheckedIndexedAccess`) on Node.js ≥ 24, ESM, vitest 4.
- **Stack:** AWS SAM + Lambda (`nodejs24.x`) + Middy 7 + AWS SDK v3 + Zod 4 + Kysely + `pg` + AWS Lambda Powertools 2. JWT via **`jose ^6.2.4`, declared in `shared/package.json` (not the root manifest)**.
- **Lint:** ESLint 10, flat config (`eslint.config.mjs`), `tseslint.configs.recommended` (**not** type-aware).
- **Workspaces:** npm workspaces — `shared`, `contexts/*`, `events/*`. ⚠ `events/` is declared but **does not exist on disk**; `identity` is the **only** bounded context currently implemented.
- **Architecture:** Domain-driven, serverless. The composition root `contexts/identity/src/composition.ts` lazily wires 10 singletons: `logger`, `tracer`, `ssm`, `eventPublisher`, `db`, `userRepository`, `auditRepository`, `userService`, `auditService`, `jwtSigner`.
- **Quality:** SonarCloud QG `Spark Match Way` (id 157178, 21 conditions). Pilot repo for the cross-repo SonarCloud rollout.
- **Branch model:** `dev` (integration) + `main` (release). Same as `spark-match-02-infrastructure`. `spark-match-01-devops` is single-`main` — do not copy its model here.

---

## 2. Hard quality gates (cannot be relaxed)

| Gate | Threshold | Where enforced |
|---|---|---|
| Coverage (overall) | ≥ 80 % | SonarCloud QG |
| Coverage (new code) | ≥ 80 % | SonarCloud QG (`new_coverage`) |
| Branch coverage | ≥ 80 % | SonarCloud QG |
| `code_smells` (overall) | 0 | SonarCloud QG (`> 0` fails) |
| `new_code_smells` | 0 | SonarCloud QG |
| `bugs`, `vulnerabilities` | 0 | SonarCloud QG |
| `sqale_rating`, `reliability_rating`, `security_rating` | A (≤ 1) | SonarCloud QG |
| `duplicated_lines_density` | ≤ 3 % | SonarCloud QG |
| Local coverage (lines/functions/branches/statements) | 80 / 80 / 80 / 80 | `vitest.config.mts:34-39`, via `pre-push` |

If any gate is red the PR is **not mergeable**.

> ⚠ **Governance gap:** in `spark-match-01-devops/governance/repository-governance.json`, this repo has
> `statusChecks: []`. That means the org ruleset does **not** currently make the 6 CI jobs
> merge-blocking — the discipline is human/agent-enforced. `01-devops` and `02-infrastructure` both
> declare real contexts. Closing this is tracked in §13.

---

## 3. Local guardrails (run before pushing)

```bash
npm ci
npm run build:shared      # MANDATORY before typecheck (see note)
npm run typecheck         # tsc --noEmit
npm run lint              # eslint . — CI-gated since PR #108, NOT in any husky hook
npm run test:coverage     # vitest with 80/80/80/80 thresholds
```

> **`build:shared` is not optional.** The root `tsconfig.json` declares **no `paths`**, so
> `@spark-match/shared/*` resolves through the npm-workspace symlink into `shared/dist` via the
> package `exports` map. Without a prior build, `npm run typecheck` fails or silently type-checks
> stale output. CI encodes this as `install-command: 'npm ci && npm run build:shared'`
> (`.github/workflows/ci.yml:29`). Vitest does **not** need it — `vite-tsconfig-paths` resolves to
> `shared/src` directly (§8).

**Husky hooks** (`.husky/`):

| Hook | Runs |
|---|---|
| `pre-commit` | `npm run typecheck` |
| `pre-push` | `npm run test:coverage` |

`npm run lint` is **not** hooked and there is **no `commit-msg` hook / commitlint config** in this repo — both are gaps versus `02-infrastructure` (§13). Run lint manually.

### Coverage thresholds (single source of truth)

[`vitest.config.mts:34-39`](vitest.config.mts) — `lines=80, functions=80, branches=80, statements=80`.
`npm run test:coverage` inherits them (no CLI overrides). `npm run test:coverage:sonar` zeroes them
deliberately so Sonar owns the gate; CI currently inlines that command rather than calling the script.

### Windows caveat

The hooks are POSIX shell scripts and fire via **Git Bash**. If your git shell is PowerShell without
Git Bash they will not fire — run the guardrail block above manually before `git push`.
`git commit --no-verify` escapes a single commit.

---

## 4. Branch and PR workflow

### 4.1 Feature → `dev`

1. `git checkout dev && git pull --ff-only origin dev && git checkout -b <type>/<scope>`.
2. Implement **plus tests**. New files must ship tests in the same PR.
3. Run the §3 guardrail block. 0 errors required.
4. Push and open the PR **against `dev`**, never `main`.
5. Wait for **all** CI jobs green (§5) — including the PR-level SonarCloud QG.
6. CODEOWNERS approval (`.github/CODEOWNERS` → `@spark-match/backend-devs`). Authors cannot self-approve, even as code owners.
7. **Squash merge** (enforced by the org ruleset). Delete the branch.

### 4.2 Commit and PR-title conventions

Conventional Commits: `<type>(<scope>): <subject>` — lower-case subject, no trailing period, header ≤ 100 chars. Types in use across the platform: `feat fix chore docs refactor test build ci perf revert`.

> **Squash-merge pitfall (from `02-infrastructure`):** GitHub builds the squashed commit subject from
> the **PR title**, not from your local commits. Amending locally does **not** fix a malformed PR
> title. You must also run:
> ```bash
> gh pr edit <num> --title "fix(ci): correct subject"
> ```

### 4.3 `dev` → `main` sync

The sync is a dedicated chore PR: `chore(sync): dev -> main (<context>)`.

**Sync when — and only when:**

| Trigger | Category |
|---|---|
| Sprint closed and QA approved | Maturity |
| Planned code freeze | Maturity |
| Critical operational hotfix | Explicit decision |
| Planned production release | Explicit decision |

**Do NOT sync:**

- After every `dev` PR (that is not what `main` is for).
- Without explicit `dev` sign-off.
- While **any** check is red or **any** CodeQL / Dependabot / GHAS alert is open.

> If in doubt, do not sync.

### 4.4 Post-sync verification (mandatory)

```bash
git fetch origin
git diff --stat origin/main origin/dev   # expected: EMPTY
```

- **Non-empty ⇒ `main` lost changes.** Stop and open a corrective sync PR.
- `git log origin/main..origin/dev` showing dozens of commits is **expected** with squash-based
  syncs and is **not** drift. Only the content diff is authoritative.

> **Live example (2026-08-03):** `git diff --stat origin/main origin/dev` returns
> `template.yaml | 2 +-` — `main` still carries a UTF-8 BOM that PR #119 stripped on `dev`.
> This is exactly what the check is for. Tracked in §13.

### 4.5 Admin-bypass policy

Bypass is permitted **only when all three** hold:

1. Every required check is SUCCESS (a legitimately SKIPPED job is acceptable; a FAILED one is not).
2. No reviewer is available, and the operational context is documented.
3. The justification is written in **both** the PR description **and** the commit body.

Bypass is **forbidden** when: any check FAILED; any CodeQL / Dependabot / GHAS alert is open; there
is a coverage gap; or the only stated reason is "urgent".

The one standing exception: a `chore(sync): dev -> main` PR may bypass the **SonarCloud QG** when the
underlying feature PRs each passed individually — the QG measures *new* code per PR and a squash sync
introduces none. All other checks must still be green, and the bypass must still be documented.

Commit-body format actually in use across the platform:

```
admin-bypass: 14 checks SUCCESS + 1 SKIPPING. <why the skip is benign>.
reviewDecision=REVIEW_REQUIRED sin reviewer. Autor @<handle> responsable.
```

---

## 5. CI pipeline — what actually runs

### `.github/workflows/ci.yml` — on PR + push to `main`/`dev`

| Job id | Recipe (`spark-match/spark-match-01-devops/.github/workflows/…`) | Notes |
|---|---|---|
| `sonar` | `reusable-sonar-typescript.yml@main` | 16 required inputs, all from `vars.SONAR_*`; needs `SONAR_TOKEN`. The recipe owns its own `concurrency` — do not add one at the caller. |
| `migrations-dry-run` | `reusable-migrations-dry-run.yml@main` | Postgres 17 service container; runs `migrate:up`. The recipe does **not** forward `--migrations-table/--schema` (node-pg-migrate v9 array bug) — our npm script carries them. |
| `actionlint` | `reusable-actionlint.yml@main` | Workflow YAML semantics gate. |
| `eslint` | `reusable-eslint.yml@main` | Runs `npm run lint`. |
| `gitleaks` | `reusable-gitleaks.yml@main` | Requires `GITLEAKS_LICENSE` forwarded **explicitly** — GitHub drops `secrets: inherit` cross-owner. |
| `yamllinks` | `reusable-yamllint.yml@main` | ⚠ job id is a typo for `yamllint` (§13). |

### `.github/workflows/codeql.yml`

`reusable-codeql.yml@main`, languages `javascript,actions`, `security-extended`, `fail-on-alerts: true`, `fail-on-severity: warning`. Daily cron `0 8 * * *` (mirrors upstream `codeql-actions.yml`). Has a `concurrency` group.

### `.github/workflows/deploy.yml`

`workflow_dispatch` only. **Not** a reusable caller — inline `checkout → setup-node → setup-sam → npm ci → build:shared → layer:build:all → sam build → sam deploy`. Uses OIDC (`id-token: write`) + a GH Environment. Consumes the IAM roles defined by `02-infrastructure` (`spark-match-sam-deploy-{env}`, `spark-match-lambda-runtime-{env}` — see that repo's `docs/IAM_ROLES.md`).

> Per §12.2, an inline workflow must carry a comment explaining **why** it is not a reusable.
> `deploy.yml` does not yet (§13).

### Linter division of labour

`.yamllint.yml` deliberately **ignores `.github/workflows/`** and `.github/dependabot.yml`: actionlint
owns workflow YAML (it understands Actions semantics), and yamllint emits spurious `truthy` warnings
on `on:`. In practice the `yamllint` job covers the SAM templates and its own config. This is
intentional, and matches `02-infrastructure`.

### Concurrency

Only `codeql.yml` defines a `concurrency` group today. `ci.yml` should adopt the PR-aware pattern used
by `02-infrastructure`:

```yaml
concurrency:
  group: ci-${{ github.workflow }}-${{ github.event.pull_request.number || github.ref }}
  cancel-in-progress: true
```

For `deploy.yml`, use `cancel-in-progress: false` — never cancel a deploy mid-flight.

---

## 6. Security alerts are P0 (merge-blocking)

Any open **CodeQL**, **Dependabot**, or **GHAS secret-scanning** alert blocks the PR. Triage:

1. **Classify** — real vulnerability, false positive, or accepted risk.
2. **Remediate at the source** — bump the dependency, fix the code, or narrow the permission.
3. **Verify zero open alerts** before requesting merge:
   ```bash
   gh api repos/spark-match/spark-match-03-backend/code-scanning/alerts --jq '[.[]|select(.state=="open")]|length'
   gh api repos/spark-match/spark-match-03-backend/dependabot/alerts   --jq '[.[]|select(.state=="open")]|length'
   ```
4. **Document** the decision in the PR body.

### Never invent a dismissal justification

Learned the hard way in `02-infrastructure` PR #65, where three alerts were dismissed with a
conceptually wrong reason, had to be re-opened and re-dismissed. Derived hard rules:

- Never dismiss an alert with a reason you do not fully understand.
- Before dismissing, `grep` the repo for the flagged resource and read the actual code.
- Mass-dismissal is an anti-pattern. Dismiss one alert at a time, each with its own reason.
- "It's a false positive" is not a justification — state *why* the flagged path is unreachable or safe.
- The only routine acceptable dismissal is a stale duplicate of an alert already fixed.

---

## 7. SonarCloud gotchas

- **New code must not introduce code smells.** One `code_smells` (CRITICAL *or* MINOR) reds the `0` threshold. Fix `S3735` (CRITICAL `void`), `S5906` (test assertion pattern), `S7755`/`S7773` (modern JS) at PR time.
- **`void` on a primitive (not a Promise) is a CRITICAL smell** (`S3735`). Use a TypeScript `_varName` prefix for intentionally unused vars instead.
- **Coverage denominator vs numerator.** A new file with no tests *lowers* overall coverage. Test in the same PR.
- **Vitest include patterns matter** (`vitest.config.mts:12-18`): `shared/src/**/*.test.ts`, `contexts/**/*.test.ts`, `events/**/*.test.ts`, `scripts/**/*.test.ts`, `tests/**/*.test.ts`. `shared/tests/**` is **not** included — put shared tests next to the code in `shared/src/`. `contexts/*/tests/` **is** collected (via `contexts/**`), so integration tests there are fine.
- **The Sonar config file is `.sonarcloud.properties`**, not `sonar-project.properties`. It sets only `sonar.test.exclusions`, to work around `new_branch_coverage` failing on test-only PRs. Beware: the devops recipe passes CLI `-D` flags that **override** same-named properties in that file.
- **`ApiError` has TWO code fields.** `err.code` is the transport-level code (e.g. `service_unavailable`); `err.details[0].code` is the AWS-specific code (e.g. `aws.unavailable`). Assert both via `toMatchObject`.

---

## 8. Path aliases (`@spark-match/shared/*`)

Resolution differs by tool — this is the single most common source of "works locally, fails in CI":

| Tool | Resolves via | Target |
|---|---|---|
| `vitest` | `vite-tsconfig-paths` plugin (devDep `^6.1.1`) | `shared/src/**` (source) |
| `tsc --noEmit` (root) | npm workspace symlink + `exports` map | `shared/dist/**` (**requires `build:shared`**) |
| Lambda runtime | `node-shared` layer | compiled `shared` |

`contexts/identity/tsconfig.json` declares `paths` → `../../shared/src/*` **and** includes `tests/**/*`,
so the plugin processes imports from test files. The root `tsconfig.json` excludes `**/*.test.ts`, so
`npm run typecheck` behaviour is unchanged.

**Rules of thumb:**

- **Production code** (`*.ts` under `src/`) always uses the alias — by policy.
- **Test files** in any location (`contexts/<ctx>/src/`, `contexts/<ctx>/tests/`, `shared/src/`) use the alias.
- **The one exception** is the two deep `vi.mock()` paths in
  `contexts/identity/src/handlers/authorizer.test.ts:8,13`
  (`'../../../../shared/src/auth/jwt-secret-loader'`, `'.../jwt-helpers'`). They are **intentional**:
  vitest keys mock resolution on the *resolved module* behind the barrel re-export, not on the alias
  used at the import site. Rewriting them to `@spark-match/shared/auth/jwt-helpers` was verified to
  break interception (the test falls through to a real SecretsManager call).
  Note that `shared/package.json` **already ships subpath `exports`** — but it exposes only *barrels*
  (`./auth`, `./http`, `./infra`, …), not leaf modules like `./auth/jwt-helpers`. Revisiting this
  requires adding leaf entries to that export map, not just "shipping exports".

### Verifying a path-alias change

Run the full suite locally **and read the output** to confirm no test file was silently skipped with
`ERR_MODULE_NOT_FOUND`. Test count must not drop. The Linux CI runner is the source of truth.

---

## 9. Repo layout

```
shared/src/                       # Reusable infra, http, auth, events, logging
  auth/                           # jose JWT, scrypt hashing, require-auth, AuthContext, jwt-secret-loader
  events/                         # EventBridge client, schema-validator, types
  http/                           # ApiError, ApiResponse, error-detail
  infra/                          # ssm-reader, secrets-reader, aws-wrapper, db-wrapper
  logger/                         # Powertools logger
  templates/                      # buildHandler() Middy pipeline factory
  index.ts                        # barrel; subpath exports declared in shared/package.json

contexts/identity/
  template.yaml                   # nested SAM stack: 12 functions, 10 log groups, throttling (ADR-018)
  src/
    composition.ts                # lazy singleton context (10 members)
    openapi.ts                    # OpenAPI 3.1 doc built from Zod schemas
    domain/                       # audit.ts, events.ts, user.ts (pure types + Zod event schemas)
    handlers/                     # 13 Lambda handlers + index
    infra/                        # user-repository, audit-repository, jwt-signer, db-connection,
                                  #   database, transaction (kysely)
    schemas/                      # Zod input schemas (11 + index)
    service/                      # user-service, audit-service
  tests/                          # integration tests (migrate, user-service)

layers/
  node-runtime/                   # zod, middy, powertools, kysely, pg, pino, zod-to-openapi (NO jose)
  node-shared/                    # compiled @spark-match/shared (build.sh only, no package.json)
migrations/                       # node-pg-migrate SQL, 001_… → 004_… (no "V" prefix)
scripts/generate-openapi.ts       # npm run generate:openapi → docs/openapi.json
tests/setup.ts                    # vitest setupFiles
.husky/                           # pre-commit (typecheck), pre-push (test:coverage)
docs/
  adr/                            # 18 ADRs, Nygard template (001…018)
  decisions.md                    # ADR index
  architecture.md  api.md  auth-rbac.md  data-model.md  error-catalog.md
  event-catalog.md  folder-structure.md  observability.md  runbook.md
  runtime-topology.md  sequence-diagrams.md  use-cases.md
  openapi.json                    # generated artifact
  audits/                         # cross-repo compliance audits
.github/
  workflows/ci.yml                # 6 jobs, delegates to devops recipes
  workflows/codeql.yml            # reusable-codeql caller, daily cron
  workflows/deploy.yml            # workflow_dispatch, inline SAM deploy via OIDC
  dependabot.yml  CODEOWNERS  pull_request_template.md
template.yaml  samconfig.toml     # SAM root stack + deploy config
.sonarcloud.properties            # sonar.test.exclusions only
.yamllint.yml  .gitattributes  .prettierrc
eslint.config.mjs                 # ESLint 10 flat config
vitest.config.mts                 # coverage thresholds 80/80/80/80 + vite-tsconfig-paths
tsconfig.json / tsconfig.base.json
```

`events/` does not exist yet despite being a declared workspace and tsconfig include.

---

## 10. Cross-repo contracts

### 10.1 Pinning `spark-match-01-devops` reusables — use `@main`

**All callers pin `@main`. Do not pin version tags.** This is a deliberate, current platform decision:

- `spark-match-01-devops/docs/VERSIONING.md` prescribes a single-`main` model with caller smoke tests.
- `spark-match-02-infrastructure` **reverted** its tag pins (`reusable-commitlint@v0.1.16`,
  `reusable-release-please@v0.1.18`) back to `@main` in PR #119/#120 (Sprint 12).
- `01-devops` does publish SemVer tags (`v0.1.2` … `v1.0.0`) via release-please, and a stray rule in
  its own `AGENTS.md` §5.2 still says to pin a tag. **That rule is contradicted by every consumer and
  by its own `VERSIONING.md` — do not act on it here** without an explicit platform-wide decision.
- Composite actions referenced *inside* the reusables are always `@main` (hardcoded upstream).

### 10.2 Catalog snapshot (21 reusables, verified 2026-08-03)

`actionlint`, `codeql`, `commitlint`, `eslint`, `gitleaks`, `latex-build`, `latex-release`,
`migrations-dry-run`, `node-build`, `node-test`, `node-typecheck`, `quality`, `release-please`,
`sonar-terraform`, `sonar-typescript`, `terraform-apply`, `terraform-destroy`, `terraform-plan`,
`terraform-validate`, `tflint`, `yamllint`.

**Internal-only** (not callable from consumers): `ci.yml`, `codeql-actions.yml`, `commitlint.yml`,
`release-please.yml`, `sbom.yml`. Note the *logic* of the last two was extracted into the
`reusable-commitlint` / `reusable-release-please` recipes — those **are** consumable.

**Atomic primitives** (`.github/actions/<name>/action.yml`): `bats-runner`,
`codeql-fail-on-alerts`, `setup-actionlint`, `validate-workflow-inputs`.

**Deleted — never reference these:** `aws-lambda-invoke`, `migrations`, `seed-users-*`,
`angular-spa-deploy`, `cfn-nag`, `container-deploy-ecr`, `lambda-permission-source-arn`, `sam-deploy`,
`sonar-python`, `terraform-fmt`, `checkov`, `python-ci`, `trivy`, and the `run-pytest-with-args`
composite.

**Recipes that own their own `concurrency`** (never duplicate at the caller): `sonar-typescript`,
`sonar-terraform`, `latex-build`, `latex-release`, `terraform-plan`, `terraform-apply`,
`terraform-destroy`.

**⚠ `reusable-quality.yml` is not portable** — it hardcodes `governance/repository-governance.json`
and a `./.github/actions/...` relative path, so it is effectively coupled to the `01-devops` layout.
Only its `bats` job generalizes.

### 10.3 Sibling repos

| Repo | Role | Branch model |
|---|---|---|
| [`spark-match-01-devops`](../spark-match-01-devops/) | Shared CI recipe catalog, governance manifest, org rulesets | single `main` + SemVer tags |
| [`spark-match-02-infrastructure`](../spark-match-02-infrastructure/) | Terraform (VPC, KMS, OIDC, IAM roles this repo deploys with) | `dev` + `main` |
| [`spark-match-08-deep-agent`](../spark-match-08-deep-agent/) | Python AI Advisor | — |

Naming conventions are owned upstream: `spark-match-01-devops/AGENTS.md` §5.1 is the source of truth
for kebab-case and brand spellings; §12.1 below mirrors it.

---

## 11. Out of scope for agents

- Modifying recipes under `spark-match-01-devops/.github/workflows/reusable-*.yml` — owned by QA/devops.
- Changing the SonarCloud Quality Gate `Spark Match Way` (id 157178) — owned by QA.
- Changing `spark-match-01-devops/governance/repository-governance.json` or applying org rulesets.
- Adding new dependencies without a separate dependency-review PR.
- Force-pushing to `main` or `dev`. Force-pushing your own feature branch to incorporate review feedback is fine.
- Dismissing security alerts without following §6.

---

## 12. CI workflow conventions and pipeline evaluation

### 12.1 Naming and pinning conventions

When creating or modifying any file under `.github/workflows/` (including caller wrappers for
`spark-match-01-devops` reusables):

- **Identifiers, inputs, outputs, display names, brand names**: kebab-case. Canonical brand spellings:
  SonarCloud → `sonar-cloud`, CodeQL → `codeql`, LaTeX → `latex`, ESLint → `eslint`, TFLint → `tflint`,
  SBOM → `sbom`, CycloneDX → `cyclonedx`, Terraform → `terraform`, yamllint → `yamllint`.
- **Exceptions to kebab-case**: GitHub Actions secrets and OS env vars stay in `SNAKE_CASE`.
  GitHub event names (`pull_request`, `workflow_call`) and third-party action names
  (`actions/checkout`, `aws-actions/setup-sam`) keep their upstream spelling.
- **Workflow-level env vars written via `echo "k=v" >> $GITHUB_ENV`** use lowercase kebab-case
  (`lower-os`, `env-name`, `cache-path`) — upstream bats tests enforce this.
- **Version pinning**:
  - Third-party actions: `@vN` (major) or `@N.N.N` (exact). **Never SHA-pinned** — enforced by
    `spark-match-01-devops/tests/bats/no-sha-pinning.bats`, and CodeQL's `unpinned-tag` /
    `unpinned-3rd-party-action` rules are excluded upstream precisely because they contradict this.
  - `spark-match-01-devops` reusables: **`@main`** (see §10.1).
- **`name:` field**: always kebab-case. With `${{ inputs.x }}` interpolation, concatenate with `-`,
  no spaces: `name: "lint-${{ inputs.environment-name }}"`.
- **Never interpolate `${{ inputs.* }}`, `${{ steps.*.outputs.* }}` or `${{ secrets.* }}` directly
  inside a `run:` block** — assign to an `env:` var first. This is a code-injection guard enforced
  upstream by `workflow-env-isolation.bats`.
- **Every workflow should declare `concurrency`.** PR-aware for CI (`cancel-in-progress: true`),
  never cancelling for deploys (`cancel-in-progress: false`). Exception: recipes listed in §10.2
  already own theirs.
- **An inline (non-reusable) workflow must carry a header comment stating why** it does not use a
  recipe, and what would have to change to consolidate it. `02-infrastructure`'s
  `terraform-security-scan.yml` is the reference example.

### 12.2 Pipeline evaluation methodology (reuse-first)

Before proposing any new reusable workflow, follow this discipline in order:

1. **Read §12.1.** Mandatory before any decision.
2. **Inventory the existing catalog** at `spark-match-01-devops` — see the §10.2 snapshot, but
   re-verify against the repo, not against this file.
3. **Decide, in this order:**
   - **(a) Direct reuse** — does a recipe cover the requirement 100 %? Cite the file and the exact inputs.
   - **(b) 80 % reuse + wrapper** — identify the gap. Either (i) a caller-side wrapper to pre/post-process,
     or (ii) extend the recipe with an optional, backward-compatible input. If the gap is one line, prefer (i);
     if it affects N future callers, prefer (ii).
   - **(c) New reusable** — only if neither applies. List which primitives compose it. If a needed
     primitive is missing and would serve N recipes, propose the primitive FIRST.
4. **Only propose creating if** no recipe applies even at 80 %, no primitive + wrapper applies, and the
   cost of forking exceeds the cost of adding to the catalog (CI + versioning + CODEOWNERS + bats tests).
5. **When proposing creation, document:**
   - Filename `reusable-<kebab>.yml` (§12.1).
   - Inputs (kebab-case) with defaults; note which are borrowed from existing recipes.
   - `permissions:` block; `id-token: write` only for OIDC; never widen scope without justification.
   - **Secrets must be declared explicitly by name**, not via `secrets: inherit` — GitHub drops
     inherited secrets across repository owners. `reusable-gitleaks.yml` documents this.
   - GH Environment binding when secrets are needed, following the catalog's current pattern
     (`environment: ${{ inputs.gh-environment || inputs.environment-name || inputs.environment }}`).
   - Risk level (low/medium/high) and backward compatibility.
6. **Output format (strict)** when proposing:

   ```
   ## Recomendacion: <reusar X> | <crear Y> | <fork Z>

   ### Inventario revisado
   - Reusables candidatos: ...
   - Primitivas atomicas: ...
   - Caller-side wrapper viable: si/no, por que

   ### Opcion recomendada
   - Accion: <reusar|wrapper|crear>
   - Justificacion: 2-3 lineas
   - Si crear: archivo, inputs, permisos, GH env binding

   ### Riesgos
   - ...
   ```

**Worked example** (PRs #107–#109): "add actionlint + eslint + gitleaks gates to backend CI" maps 1:1
to three existing recipes. Recommendation: `reusar` all three. `gitleaks` required verifying
`GITLEAKS_LICENSE` exists as an org secret with visibility `all`
(`gh api orgs/spark-match/actions/secrets`); it does. No new recipe needed.

---

## 13. Known drift and backlog

Verified 2026-08-03. Fix these in scoped PRs; do not bundle them.

### Correctness (fix first)

| # | Issue | Evidence |
|---|---|---|
| B1 | `GET /v1/audit` is wired to the wrong Lambda — the `AuditApi` HttpApi event is nested under `IdentityUpdateUserFunction.Events`, so the route resolves to `update-user.handler`. `IdentityAuditFunction` has no `Events:` block. | `contexts/identity/template.yaml:333-345` vs `452-471` |
| B2 | `Type: HttpApi::Auth` is not a valid SAM/CloudFormation resource type. | `contexts/identity/template.yaml:394` |
| B3 | `sam deploy --config-env dev` / `staging` will fail — `samconfig.toml` only defines `[default]` and `[prod]`. | `deploy.yml:10,49` vs `samconfig.toml:3,31` |
| B4 | `CorsAllowedOrigins` is `!Ref`-ed in the nested identity stack but never declared as a parameter there, and the root stack never passes it. | `contexts/identity/template.yaml:42` vs `7-25`; `template.yaml:139-145` |
| B5 | `main` still carries a UTF-8 BOM on `template.yaml` that `dev` removed in PR #119. Next sync resolves it; verify with §4.4. | `git diff origin/main origin/dev -- template.yaml` |
| B6 | `deploy.yml` builds on Node 20 while the Lambda runtime and `engines` require Node 24. | `deploy.yml:28` vs `template.yaml:47` |

### Dependency / config hygiene

| # | Issue |
|---|---|
| B7 | Version drift across manifests: `zod` root+shared `^4.4.3` vs layer `^3.23.0`; `kysely` root `^0.29.0` vs layer `^0.27.0`; `vitest` root `^4.1.10` vs `contexts/identity` `^2.0.0`. |
| B8 | `zod` and `@aws-sdk/client-ssm` are root **devDependencies** but runtime deps of `shared`. |
| B9 | `@asteasolutions/zod-to-openapi` is declared in `layers/node-runtime` but imported nowhere. |
| B10 | `events/*` is a declared npm workspace and tsconfig include, but `events/` does not exist. |
| B11 | `layers/node-shared/` has a `build.sh` but no `package.json`. |
| B12 | `shared/src/test-utils/` is an empty untracked directory; `shared/dist/test-utils/` holds stale compiled artifacts. |

### Process gaps versus sibling repos

| # | Gap | Reference |
|---|---|---|
| B13 | **No commitlint.** No `.commitlintrc.json`, no `commit-msg` hook, no CI job — despite §4.2 prescribing Conventional Commits. `reusable-commitlint.yml@main` covers this 100 %; `02-infrastructure` pairs it with a zero-dependency local hook and a bats drift detector. |
| B14 | **Dependabot targets the default branch.** `.github/dependabot.yml` has no `target-branch: dev`, so its PRs land against `main`, bypassing the §4.1 rule. It also lacks a `commit-message.prefix` (`ci(deps)`) and a `github-actions` ecosystem entry — workflow action versions are currently untracked. |
| B15 | **No `concurrency` on `ci.yml` / `deploy.yml`.** See §5. |
| B16 | **`statusChecks: []` in the org governance manifest** — CI is not ruleset-required for this repo. Requires a devops-owned change (§11). |
| B17 | No `CHANGELOG.md` / release automation. `reusable-release-please.yml@main` exists; `02-infrastructure` runs it with a GitHub App. Note that `chore:` sync commits deliberately do not trigger a version bump. |
| B18 | No `CONTRIBUTING.md`, `LICENSE`, or `SECURITY.md` at root — CODEOWNERS and the README both reference them. |
| B19 | ESLint uses `tseslint.configs.recommended` without `parserOptions.project`, so type-aware rules SonarCloud may flag are not caught locally. |

### Documentation drift

| # | Issue |
|---|---|
| B20 | `.github/CODEOWNERS` routes nonexistent paths (`/decisions/`, `/onboarding/`, `/postmortems/`, `/CONTRIBUTING.md`, `/LICENSE`, `/.eslintrc.cjs`) and does **not** cover `package.json`, `tsconfig*.json`, `vitest.config.mts`, `eslint.config.mjs`, `AGENTS.md`. Team roster contradicts the README. |
| B21 | `pull_request_template.md` references `contexts/assessment|career|matching`, `events/`, and `docs/CHANGELOG.md` — none exist. It has no reviewer checklist and no cross-repo PR link field (both present in `02-infrastructure`). |
| B22 | `README.md` links `../LICENSE` and `../BACKEND.md` (neither exists), omits `codeql.yml`, still says `migrations/ (V001+)`, and diagrams four bounded contexts that do not exist. |
| B23 | `codeql.yml` header comments are stale (say "weekly Monday 06:17 UTC" vs the actual daily `0 8 * * *`; reference `codeql.yml@main` vs the actual `reusable-codeql.yml@main`). |
| B24 | `docs/decisions.md:33` says "pick the next sequential number (e.g. `015`)" — the next free number is `019`. ADR-017 and ADR-018 are still `Propuesto`. |
| B25 | The `yamllinks` job id in `ci.yml:77` is a typo for `yamllint`, and violates §12.1's brand-spelling rule. |

### Terminology

Prior sprint notes mix "Sprint 3 P3 close-out", "Sprint 1 hygiene pass", "B8", and "§12".
`02-infrastructure` eliminated this ambiguity by standardizing on a single **`Sprint N`** axis.
Use `Sprint N` for time-boxed work and `B<n>` only for backlog IDs in §13.

---

## 14. References and sprint history

- SonarCloud dashboard: https://sonarcloud.io/dashboard?id=spark-match-03-backend
- SonarCloud QG `Spark Match Way`: https://sonarcloud.io/quality_gates/show/157178
- Upstream naming conventions: `spark-match-01-devops/AGENTS.md` §5.1
- Upstream pinning/versioning policy: `spark-match-01-devops/docs/VERSIONING.md`
- IAM roles consumed by `deploy.yml`: `spark-match-02-infrastructure/docs/IAM_ROLES.md`
- Sync-process and security-triage patterns adopted here: `spark-match-02-infrastructure/AGENTS.md`
- Org-level hardening notes: `BACKEND-HARDENIN-26-07.md` (in the workspace parent directory, **not** this repo root)

### Sprint history

- **Sprint 1** (2026-07-28, hygiene + discoverability): PR #55 Dependabot, PR #57 README badges, PR #58 vitest thresholds, PR #59 ADR migration.
- **Sprint 3** (2026-07-30/31, feature close-out): PR #79/#80 authorizer wiring, PR #81/#82 TTL + IAM, PR #83/#84 OpenAPI from Zod, PR #85/#86 `GET /v1/audit` admin, PR #87/#88 CORS allowlist + typecheck tsconfig, PR #90 path-alias docs, PR #94 `vite-tsconfig-paths` adopted (path-alias resolution on Linux CI closed).
- **Sprint 3 — CI modernization** (2026-08-03): PR #107 renamed callers to the `reusable-*` prefix; PR #108 adopted `reusable-actionlint` + `reusable-eslint`; PR #109 adopted `reusable-gitleaks`; PR #110 dropped SHA-pinning in `deploy.yml`; PR #111 documented §12; PR #112/#115 adopted `reusable-yamllint`; PR #114 synced the codeql daily cron; PR #116 synced dev → main. CI went from 3 jobs to 6.
- **Sprint 3 — housekeeping** (2026-08-03): PR #117 §12 doc fixes, PR #118 kebab-case step names in `deploy.yml`, PR #119 LF enforcement via `.gitattributes`, PR #120 cross-repo §12.1 compliance audit (`docs/audits/`), PR #121 synced dev → main.
- **Sprint 4 — cross-repo alignment** (2026-08-03): this AGENTS.md rewrite. Reconciled against `01-devops@7913515` and `02-infrastructure@7e588bb`; corrected 14 factual drifts; adopted the sync-verification, promotion-criteria, security-triage and admin-bypass disciplines from `02-infrastructure`; opened the §13 backlog (B1–B25).
