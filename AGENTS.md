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

- Modifying the recipe under `spark-match-01-devops/.github/workflows/sonar-*.yml`. That is owned by QA / devops.
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
