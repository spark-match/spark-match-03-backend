## Why this PR exists

\`origin/main\` currently sits at \`e799317\` (the explicit-paths CODEOWNERS file) plus \`47fdd17\` (PR #18 RBAC + JWT signer factory). Three things were already on \`dev\` but not yet on \`main\`:

- **P0** (`#23`): cleared 4 SonarCloud code smells introduced by PRs #18/#20.
- **P1** (`#24`): added 18 new vitest tests for the AWS-infra glue code (composition root, jwt-signer, db-connection). Restored coverage from 81.5% to 89.7%.
- **P2.1** (`#25`): \`npm run test:coverage\` now enforces 80% local threshold.
- **P2.2** (`#26`): Husky \`pre-commit\` (typecheck) + \`pre-push\` (test:coverage) hooks.
- **P2.3** (`#27`): \`AGENTS.md\` quality policy + workflow guide.
- **P2.4** (`#28`): explicit CODEOWNERS file synced from main into dev.

This PR merges all six PRs (#23–#28) into \`main\` to fully land the hardening cycle.

## What this PR contains

- 28 files changed, +1635 / -17.
- New tests: \`composition.test.ts\`, \`jwt-signer.test.ts\`, \`db-connection.test.ts\` (all 100% coverage on their targets).
- \`.husky/pre-commit\` + \`.husky/pre-push\`.
- \`AGENTS.md\` (root).
- \`package.json\` + \`package-lock.json\` (husky + threshold script).

## Expected outcome (SonarCloud)

Once this lands in \`main\`, the next main push will see:

| Metric | Before (this PR) | After (expected) |
|---|---|---|
| QG status | ERROR (4 smells, 0 coverage on new files) | OK 21/21 |
| \`coverage\` overall | 81.5% | 89.7%+ |
| \`code_smells\` (overall) | 4 | 0 |
| \`new_code_smells\` (window) | 4 | 0 |

## How to validate locally

```bash
npm ci && npm run build:shared
npm run test:coverage           # all tests + thresholds pass
git log --oneline -8            # see all 6 PR commits + the original codeowners
```

The Husky hooks will fire on \`git commit\` and \`git push\` automatically (Git Bash on Windows).

Refs: BACKEND-HARDENIN-26-07.md (org-level harness document at \`/orion\`).
