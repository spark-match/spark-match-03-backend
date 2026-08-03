# AGENTS.md — Spark Match Backend (spark-match-03-backend)

> Working agreement for AI agents (and humans) contributing to this repo.
> Last updated: 28-jul-2026 (Sprint 1 hygiene pass; PRs #55/#57/#58/#59).

## Repo at a glance

- **Language:** TypeScript 6 (strict) on Node.js ≥ 24, ESM, vitest 4.
- **Stack:** AWS SAM + Lambda + Middy + AWS SDK v3 + Zod 4 + Kysely + pg + AWS Lambda Powertools + jose 6.2.4 (JWT).
- **Lint:** ESLint 10 with flat config (`eslint.config.mjs`).
- **Architecture:** Domain-driven, serverless. Composition root (`contexts/identity/src/composition.ts`) wires Lambda handlers to AWS clients + repositories + services.
- **Quality status:** SonarCloud `Spark Match Way` QG (id 157178, 21 conditions). Pilot repo for the cross-repo SonarCloud rollout.

## Hard quality gates (cannot be relaxed)

| Gate | Threshold | Where enforced |
|---|---|---|
| Coverage (overall) | ≥ 80 % | SonarCloud QG, blocked by CI |
| Coverage (new code) | ≥ 80 % | SonarCloud QG (`new_coverage`) |
| Branch coverage | ≥ 80 % | SonarCloud QG |
| `code_smells` (overall) | 0 | SonarCloud QG (auto `> 0`) |
| `new_code_smells` | 0 | SonarCloud QG |
| `bugs`, `vulnerabilities` | 0 | SonarCloud QG |
| `sqale_rating`, `reliability_rating`, `security_rating` | A (≤ 1) | SonarCloud QG |
| `duplicated_lines_density` | ≤ 3 % | SonarCloud QG |

If any gate is red the PR is **not mergeable** to `main`.

## Local guardrails (run before pushing)

```
npm run typecheck            # ~5s, fails on TS errors
npm run test:coverage        # ~5s, runs all vitest tests with 80/80/80/80 thresholds
```

Both scripts are run automatically by **Husky** git hooks:

- `pre-commit` → `npm run typecheck`
- `pre-push`   → `npm run test:coverage` (covers new files + thresholds)

### Coverage thresholds (single source of truth)

Defined in [`vitest.config.mts`](vitest.config.mts#L29-L34): `lines=80, functions=80, branches=80, statements=80`. `npm run test:coverage` inherits them (no CLI overrides). Local pre-push gate; SonarCloud enforces its own per-PR gate independently.

### Windows caveat

The hooks are POSIX shell scripts. They fire correctly via **Git Bash**. On Windows:
- If you use **Git Bash** (default Git for Windows shell): hooks fire automatically.
- If you use **PowerShell as your git shell** without Git Bash: hooks will not fire.
  Workaround: run `npm run typecheck && npm run test:coverage` manually before `git push`.
  Or escape a single commit with: `git commit --no-verify -m "..."`.

## Workflow

1. Branch off `dev` (not `main`): `git checkout dev && git checkout -b <type>/<scope>`.
2. Implement + tests. New files must include tests.
3. Run locally: `npm run typecheck && npm run test:coverage`. Must be 0 errors.
4. Push branch, open PR to `dev` (not `main`).
5. CI runs SonarCloud scan → PR-level QG must be OK.
6. CODE OWNERS approval required (`.github/CODEOWNERS` → `@spark-match/backend-devs`).
7. Merge with squash (ruleset enforces this).
8. **Dev → main sync** is a dedicated chore PR (`chore(sync): dev -> main (PR #NN ...)`). Each sprint ends with a sync PR. The sync PR admin-bypasses the SonarCloud QG when the underlying feature PRs already passed individually (QG measures new code per PR; the sync adds no new code).

## SonarCloud gotchas

- **New code must not introduce code smells.** Even 1 `code_smells` (CRITICAL or MINOR) blocks the QG on `0` threshold. If you see `S3735` (CRITICAL `void`), `S5906` (test assertion pattern), `S7755`/`S7773` (modern JS), etc. — fix immediately at PR time.
- **Coverage denominator vs. numerator.** Adding a new file with no tests *reduces* overall coverage. Mitigation: test at the same PR.
- **Vitest pattern matters.** `shared/tests/**/*.test.ts` is NOT in the vitest include. Always put tests under `shared/src/...` next to the code.
- **`ApiError` has TWO code fields.** `err.code` is the transport-level code (e.g. `service_unavailable`); `err.details[0].code` is the AWS-specific code (e.g. `aws.unavailable`). Match both in tests via `toMatchObject`.
- **`void` on a primitive (not a Promise) is a CRITICAL smell** (`S3735`). Use TypeScript underscore prefix `_varName` for intentionally unused vars.

## Path aliases (`@spark-match/shared/*`)

The workspace alias `@spark-match/shared/*` resolves via **`vite-tsconfig-paths`** (npm devDep, v6.1.1+) — a Vitest/Vite plugin that walks the directory tree and reads the `paths` from the nearest `tsconfig.json` for each module. This works on local Windows **and** the Linux CI runner.

**Per-context tsconfig** (`contexts/identity/tsconfig.json`) declares `paths` → `../../shared/src/*` **and** includes `tests/**/*` so the plugin processes imports from test files too. The root `tsconfig.json` (used by `npm run typecheck`) still excludes tests, so typecheck behavior is unchanged.

**Rules of thumb:**

- **Production code** (`*.ts` under `src/`) should always use the alias — it does, by policy.
- **Test files** in any location (`contexts/<ctx>/src/`, `contexts/<ctx>/tests/`, `shared/src/`) should use the alias. The plugin handles resolution uniformly.
- **`vi.mock()` deep paths inside `contexts/identity/src/handlers/authorizer.test.ts`** (`'../../../../shared/src/auth/jwt-helpers'` etc.) are the **one** exception. They are **intentional** — vitest's mock resolution keys on the *resolved module* of the barrel's re-export, not the alias form used at the import site. Replacing them with `'@spark-match/shared/auth/jwt-helpers'` was verified to break the mock interception (the test falls through to the real SecretsManager call). If the `shared` package ever ships subpath `exports`, this can be revisited.

### Verifying a path-alias change

Before pushing any change that touches alias imports/exports, run the suite locally **and** read the `npm run test:coverage` output to confirm no test file is silently skipped due to `ERR_MODULE_NOT_FOUND`. CI (Linux runner) is the source of truth.

## Repo layout

```
shared/src/                       # Reusable infra, http, auth, events
  auth/                           # JWT (jose), password hashing (scrypt), require-auth, AuthContext
  events/                         # EventBridge client, schema-validator
  http/                           # ApiError, ApiResponse, error-detail
  infra/                          # ssm-reader, secrets-reader, aws-wrapper, db-wrapper
  logger/                         # Powertools logger
  templates/                      # buildHandler() Middy pipeline factory

contexts/identity/src/
  composition.ts                  # Lazy singleton context (logger, ssm, db, jwt signer)
  service/user-service.ts         # Business rules + RBAC + domain events
  infra/                          # user-repository (kysely), jwt-signer, db-connection
  schemas/                        # Zod input schemas
  handlers/                       # Lambda handler exports
  domain/                         # Pure types + Zod event schemas
  tests/                          # Integration tests (migrate, user-service)

layers/                           # Lambda layer build artifacts
  node-runtime/                   # zod, middy, powertools, kysely, pg, jose
  node-shared/                    # compiled @spark-match/shared
migrations/                       # node-pg-migrate SQL files (V001+)
.husky/                           # Git hooks (pre-commit, pre-push)
docs/
  architecture.md                 # Layered architecture overview
  decisions.md                    # ADR index
  adr/                            # One file per ADR (Nygard template)
  event-catalog.md                # EventBridge event JSON schemas
  folder-structure.md             # Documented layout (some dirs aspirational)
  observability.md                # Powertools observability guide
.github/
  workflows/ci.yml                # Delegates to spark-match-01-devops recipe
  dependabot.yml                  # Weekly npm updates (since Sprint 1 / PR #55)
  CODEOWNERS                      # Path-based reviewer routing
  pull_request_template.md
eslint.config.mjs                 # Flat config (ESLint 10)
vitest.config.mts                 # Coverage thresholds (80/80/80/80)
```

## Out of scope for agents

- Modifying recipes under `spark-match-01-devops/.github/workflows/reusable-*.yml`. That is owned by QA / devops.
- Changing the SonarCloud Quality Gate `Spark Match Way` (id 157178). Owned by QA.
- Adding new dependencies without a separate dependency-review PR.
- Force-pushing to `main` or `dev`. Force-push to your own branch is OK to incorporate PR review feedback.

## References

- Hardening cycle that produced this file: `BACKEND-HARDENIN-26-07.md` at the repo root (org-level).
- SonarCloud dashboard: https://sonarcloud.io/dashboard?id=spark-match-03-backend
- SonarCloud QG: https://sonarcloud.io/quality_gates/show/157178
- Cross-repo SonarCloud pilot docs: `BACKEND-HARDENIN-26-07.md`
- Sibling repos in the platform: [`spark-match-08-deep-agent`](../spark-match-08-deep-agent/) (Python AI Advisor), [`spark-match-01-devops`](../spark-match-01-devops/) (shared CI recipes), [`spark-match-02-infrastructure`](../spark-match-02-infrastructure/) (Terraform infra).
- Sprint history:
  - **Sprint 1** (2026-07-28, hygiene + discoverability): PR #55 Dependabot, PR #57 README badges, PR #58 vitest thresholds, PR #59 ADR migration.
  - **Sprint 3 P3 close-out** (2026-07-30): PR #79 + #80 authorizer wiring, PR #81 + #82 TTL/IAM, PR #83 + #84 OpenAPI from Zod, PR #85 + #86 `GET /v1/audit` admin, PR #87 + #88 CORS allowlist + typecheck tsconfig. PR #89 closed (documented B8); PR #90 merged B8 docs. **B8 fully closed** (2026-07-31): `vite-tsconfig-paths` adopted, deep paths in `contexts/identity/tests/*.test.ts` migrated to alias — see `Path aliases` section above.
  - **Sprint 3 CI modernization** (2026-08-03, dev + main aligned): PR #107 renamed 3 callers to the `reusable-*` prefix after `spark-match-01-devops` standardized its catalog; PR #108 adopted `reusable-actionlint.yml` (workflow YAML syntax gate) and `reusable-eslint.yml` (npm lint gate); PR #109 adopted `reusable-gitleaks.yml` (secret-scan gate via org-level `GITLEAKS_LICENSE`); PR #110 fixed SHA-pinning in `deploy.yml` per §12.1; PR #111 documented §12 (naming conventions + pipeline-evaluation methodology); PR #112 + #115 adopted `reusable-yamllint.yml` (config + job); PR #114 synced codeql cron from PR #113 (daily `0 8 * * *`); PR #116 chore-synced dev → main. CI went from 3 jobs (sonar, migrations-dry-run, codeql) to 6 jobs (+ actionlint, eslint, gitleaks, yamllinks).

## 12. CI workflow conventions and pipeline evaluation

### 12.1 Naming and pinning conventions

When creating or modifying any file under `.github/workflows/` (including caller wrappers for `spark-match-01-devops` reusables):

- **Identifiers, inputs, outputs, display names, brand names**: kebab-case. Canonical brand spellings: SonarCloud → `sonar-cloud`, CodeQL → `codeql`, LaTeX → `latex`, ESLint → `eslint`, TFLint → `tflint`, SBOM → `sbom`, CycloneDX → `cyclonedx`, Terraform → `terraform`.
- **Exceptions to kebab-case**: GitHub Actions secrets and OS env vars stay in `SNAKE_CASE`.
- **Third-party sub-actions** (`actions/checkout`, `aws-actions/setup-sam`, etc.) keep upstream names — do NOT kebab-case them.
- **Version pinning**: `@vN` (major) or `@N.N.N` (exact). Never SHA-pinned. Enforced by `spark-match-01-devops/tests/bats/no-sha-pinning.bats`.
- **`name:` field**: always kebab-case. When using `${{ inputs.x }}` interpolation, concatenate segments with `-` (no spaces). Example: `name: "lint-${{ inputs.environment-name }}"`.

### 12.2 Pipeline evaluation methodology (reuse-first)

Before proposing any new reusable workflow, follow this discipline in order:

1. **Read conventions (§12.1 above)**. Mandatory before any decision.
2. **Inventory the existing catalog** at `spark-match-01-devops`:
   - Reusables (`reusable-*.yml`): `actionlint`, `codeql`, `eslint`, `gitleaks`, `latex-build`, `latex-release`, `migrations-dry-run`, `node-build`, `node-test`, `node-typecheck`, `quality`, `sonar-terraform`, `sonar-typescript`, `terraform-apply`, `terraform-destroy`, `terraform-plan`, `terraform-validate`, `tflint`, `yamllint`.
   - **Internal-only** (NOT callable from consumers per `spark-match-01-devops/docs/VERSIONING.md`): `ci.yml`, `codeql-actions.yml`, `commitlint.yml`, `release-please.yml`, `sbom.yml`.
   - Atomic primitives (`spark-match-01-devops/.github/actions/<name>/action.yml`): `bats-runner`, `codeql-fail-on-alerts`, `setup-actionlint`, `validate-workflow-inputs`.
3. **Decide, in this order**:
   - **(a) Direct reuse**: does a reusable cover the requirement 100%? Cite the file and exact inputs that apply.
   - **(b) 80% reuse + caller-side wrapper**: identify the gap. Two options: (i) caller-side wrapper to pre/post-process; (ii) extend the reusable with an optional retrocompatible input. If the gap is 1 line, prefer (i); if it affects N future callers, prefer (ii).
   - **(c) New reusable**: only if neither (a) nor (b) applies. List which existing primitives can be composed. If a needed primitive is missing and would be reused in N reusables, propose creating the primitive FIRST, then the reusable.
4. **Only propose creating if**:
   - No existing reusable applies (even at 80%).
   - No atomic + caller-side wrapper applies.
   - The cost of forking (copy + maintain outside catalog) is greater than the cost of adding to the catalog (CI + versioning + CODEOWNERS + bats tests).
5. **When proposing creation, document**:
   - Filename: `reusable-<kebab>.yml` (per §12.1).
   - Inputs (kebab-case) with defaults; note which are reused from existing recipes.
   - `permissions:` block; use `id-token: write` for OIDC; never introduce new scopes without justification.
   - Steps that reference existing reusables/primitives; if introducing a new step, justify.
   - GH Environment binding when secrets are needed: `environment: ${{ inputs.environment-name || inputs.environment || inputs.working-directory }}` with `secrets: inherit` (or the catalog's current pattern).
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

**Worked example** (PRs #107–#109, Sprint 3 P3 close-out): the requirement "add actionlint + eslint + gitleaks gates to backend CI" maps 1:1 to three existing reusables. Recommendation: `reusar` all three. `gitleaks` required verifying that `GITLEAKS_LICENSE` is configured as an org secret with visibility `all` (`gh api orgs/spark-match/actions/secrets`); it is. No new recipe needed.
