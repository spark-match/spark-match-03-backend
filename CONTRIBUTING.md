# Contributing to Spark Match Backend

> **Read this first.** The repo is small but the gates are loud. Most PRs
> fail because authors skip step 1 or step 4.

## 1. Local setup

```bash
npm ci
npm run build:shared      # required before typecheck (AGENTS.md §3)
npm run typecheck         # tsc --noEmit
npm run lint              # eslint . — NOT in any husky hook, run manually
npm run test:coverage     # vitest with 80/80/80/80 thresholds
```

> **Git Bash is required for the husky hooks.** Without Git Bash
> (e.g. PowerShell-default git shell on Windows), the
> `pre-commit` (typecheck) and `pre-push` (test:coverage) hooks do
> not fire and the PR will arrive red. **Either install Git Bash or
> run the guardrails manually before `git push`.** The hooks are
> POSIX shell scripts (`.husky/pre-commit`, `.husky/pre-push`).

## 2. Branch & commit conventions

- **Branch off `dev`.** Never commit to `dev` or `main` directly.
- **Conventional Commits**: `<type>(<scope>): <subject>` — lower-case
  subject, no trailing period, header ≤ 100 chars.
  - Types: `feat fix chore docs refactor test build ci perf revert`.
  - Scopes are observed in `.commitlintrc.json` and grew over time —
  pick the closest match, do not invent new ones unless you add the
  scope to `.commitlintrc.json` in the same PR.
- **Subject-case, body-max-line-length, footer-max-line-length** are
  intentionally disabled in `.commitlintrc.json` because historical
  PRs use mixed casing and admin-bypass bodies exceed 100 chars.
  Do not re-enable them without a separate cleanup PR.

### Squash-merge pitfall

The PR title becomes the squashed commit subject. GitHub builds it
from the **PR title**, not from your local commits. If you amend
the commit message locally the PR title does not move.

```bash
gh pr edit <num> --title "fix(ci): correct subject"
```

## 3. What "green" means

Hard gates (must all be green before merge):

| Gate | Threshold | Local proxy |
|---|---|---|
| Coverage overall | ≥ 80 % | `npm run test:coverage` |
| Coverage new code | ≥ 80 % | `npm run test:coverage` |
| Branch coverage | ≥ 80 % | `npm run test:coverage` |
| Code smells | 0 | `npm run lint` |
| New code smells | 0 | `npm run lint` |
| Bugs, vulnerabilities | 0 | `npm run typecheck` |
| SQALE, reliability, security rating | A | (Sonar only) |
| Duplicated lines density | ≤ 3 % | `npm run lint` |

A single MINOR smell fails the gate. Read `AGENTS.md` §2 for the
full table.

## 4. Open security alerts are P0

Run before requesting review:

```bash
gh api repos/spark-match/spark-match-03-backend/code-scanning/alerts --jq '[.[]|select(.state=="open")]|length'
gh api repos/spark-match/spark-match-03-backend/dependabot/alerts   --jq '[.[]|select(.state=="open")]|length'
```

Both must be `0`. If you have a CodeQL alert you cannot fix:

1. Read the alert rule and the flagged code.
2. Verify the flagged path is unreachable (false positive) or that
   the risk is documented and accepted.
3. Dismiss with a reason that names the actual reason — never with
   "false positive" alone.

See `AGENTS.md` §6 for the full triage playbook.

## 5. Tests come with the code

Every new file ships with a test in the same PR. Coverage drops if
you do not. SonarCloud will red the gate.

- Place test files next to source: `shared/src/foo/bar.ts` →
  `shared/src/foo/bar.test.ts`.
- Vitest include patterns live in `vitest.config.mts:12-18`.
- **Do not** put shared tests in `shared/tests/` — they are not
  collected.

## 6. Working with reusable workflows

CI/CD lives in `spark-match-01-devops` (`.github/workflows/reusable-*.yml`).
This repo's callers (`ci.yml`, `codeql.yml`, `deploy.yml`) pin
`@main` deliberately. Do not pin version tags. See
`AGENTS.md` §10.1 for the rationale.

## 7. PR content checklist

- [ ] Branch off `dev`, never `main`.
- [ ] Local guardrail block (`npm ci && build:shared && typecheck &&
  lint && test:coverage`) is green.
- [ ] Conventional Commit title (lower-case `<type>(<scope>): <subject>`).
- [ ] New code has unit tests in the same PR.
- [ ] No new code smells (`tsc` + `eslint` clean).
- [ ] No open security alerts.
- [ ] Body explains *why*, not *what* (the diff shows the *what*).
- [ ] Cross-repo impact noted in the description if any.

## 8. Code review

- The CODE_OWNER is `@spark-match/backend-devs`. CODEOWNERS see
  `.github/CODEOWNERS` for the full coverage map.
- Authors cannot self-approve, even as code owners.
- Squash-merges only. The repo's ruleset enforces `rebase_merge=false,
  merge_commit=false, squash_merge=true`.

## 9. The dev → main sync

`main` is updated only by a dedicated `chore(sync): dev -> main`
PR. The sync is not automatic. See `AGENTS.md` §4.3 for the
trigger conditions and §4.4 for the post-sync verification.

## 10. Where to ask

- **CI/CD questions**: see `AGENTS.md` (this repo) and
  `AGENTS.md` of the relevant sibling repo.
- **Architecture / ADRs**: `docs/decisions.md` (18 ADRs to date).
- **API surface**: `docs/openapi.json` (generated, do not edit).
- **Bugs**: open a GitHub issue and link the relevant PR.
