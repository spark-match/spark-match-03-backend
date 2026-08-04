# 2026-08-04 — `main` homologation attempt + admin task pending

## Status

**DEFERRED (admin task)**. The repo ruleset blocks linearization via direct
push. The agent attempted `git push origin dev:main --force-with-lease` and
was rejected by 3 rules. The user (developer) chose to do the admin task
(ruleset relaxation) themselves. Linearization will resume once the ruleset
is relaxed.

This doc captures the diagnostic, the rules, and the admin task steps so
the next agent can resume work without re-investigating.

## Symptom

User observed:

```
git log origin/main..origin/dev --oneline   # 103 commits
git log origin/dev..origin/main --oneline   #  37 commits
```

…and concluded branches were "diverging". This is the **squash-merge
topology** documented in AGENTS.md §4.4, not real content drift:

```
git diff --stat origin/main origin/dev
docs/audits/sonarcloud-binding-fix-2026-08-04.md | 209 +++++++++++++++++++++++
1 file changed, 209 insertions(+)
```

Only one file actually differs. Everything else is content-identical — the
divergence is in commit *graphs*, not in repository *content*.

## Why linearization matters

User intent: make `main` and `dev` topologically identical so that
`git log origin/main..origin/dev` and `git log origin/dev..origin/main`
both return empty after a sync. This eliminates the "ahead/behind"
visual noise and makes the audit trail of releases match the working
history.

## Repo ruleset that blocks linearization

GitHub org-level ruleset on `spark-match/spark-match-03-backend`:

1. **"Changes must be made through a pull request"** — direct push to
   `main` is forbidden.
2. **"Cannot force-push to this branch"** — `git push --force` (with or
   without `--force-with-lease`) is rejected.
3. **"This branch must not contain merge commits"** — `main` must have a
   linear history (the `Require linear history` rule from the org ruleset).

Together, these rules mean:
- We cannot `git push origin dev:main --force-with-lease`.
- We cannot `git push origin dev:main` (non-fast-forward is rejected).
- We cannot open a PR with merge commits (would violate rule 3).

The error observed at the rejected push:

```
remote: error: GH013: Repository rule violations found for refs/heads/main.
remote: - Changes must be made through a pull request.
remote: - Cannot force-push to this branch
remote: - This branch must not contain merge commits.
remote:   Found 1 violation:
remote:   0b036dbeeb12845b76c66f42ff405e0e83fdb0a1
```

The merge commit `0b036db` flagged is one of 7 historical `Merge branch 'main' into dev`
commits in dev's history (pre-squash-merge-policy era, ~2026).

## Admin task to enable linearization (Path 0)

User chose to do this themselves. Steps:

1. Open https://github.com/spark-match/spark-match-03-backend/rules
2. Identify the ruleset that enforces "PR-only / no force-push / linear history"
   on `main`. It's likely named `main-protection` or similar.
3. Either:
   - **(a) Disable the ruleset temporarily** for the duration of the linearization
     push, then re-enable. Simpler but opens a window where main is unprotected.
   - **(b) Modify the ruleset** to allow:
     - Force-pushes by specific admins (or the `@spark-match/backend-admins` team)
     - Merge commits (toggle off "Require linear history" or its equivalent)
     - Direct pushes from `dev` (rare; usually not how rulesets work)
4. Once relaxed, the agent (or user) executes:
   ```bash
   git push origin dev:main --force-with-lease
   ```
5. Re-enable / re-tighten the ruleset.
6. Verify post-push:
   ```bash
   git diff --stat origin/main origin/dev   # expected: EMPTY
   git log origin/main..origin/dev --oneline  # expected: EMPTY
   git log origin/dev..origin/main --oneline  # expected: EMPTY
   ```

If step 4 succeeds, `main` and `dev` are topologically identical. The 37
squash-merged sync commits on main become orphaned (still reachable via
the backup branch — see below) but no longer affect the working view.

### Backup branch (created 2026-08-04)

The pre-linearization state of `main` is preserved in:

- Local: `backup-main-pre-linearize`
- Remote: `origin/backup-main-pre-linearize` (commit `c12b23a`)

This branch contains the original 37-commit topology. If linearization
causes data loss or audit-trail concerns, this branch can be promoted
back to `main` (with ruleset relaxation).

The backup branch can be deleted 30 days after successful linearization,
once the team confirms the new topology is acceptable.

## Fallback path (Path 1 — rules-compliant)

If the admin task is not done, linearization can be approximated with a
**rebase-merge via PR**. This satisfies all 3 rules without modifying them.

Steps:

1. Create a feature branch off dev:
   ```bash
   git checkout dev
   git checkout -b chore/linearize-main
   ```
2. Rebase onto main, dropping merge commits:
   ```bash
   git rebase origin/main
   ```
   Expected: ~72 commits replayed, conflicts likely on `.gitignore`,
   `package-lock.json`, and any file that dev has touched since the
   squash-merge policy was established.
3. Resolve conflicts. Use `git rebase --skip` for commits that are
   already in main's history (squash-equivalent content).
4. Push the rebased branch:
   ```bash
   git push origin chore/linearize-main
   ```
5. Open a PR against `main`. The ruleset forces
   "Rebase and merge" or "Squash and merge" as the only valid strategies.
6. Use **Rebase and merge** to preserve granular history on `main`.

After this, `main` has dev's history linearized (no merge commits) but
**dev itself is unchanged** — its 7 merge commits remain. So:

- `git log origin/main..origin/dev` ≠ EMPTY (dev still has merge commits).
- `git log origin/dev..origin/main` = EMPTY (main is a strict ancestor).

This is partial homologation. The user wanted perfect homologation;
Path 1 doesn't fully deliver but doesn't require rule changes either.

## Alternative (Path A — content homologation only)

If neither Path 0 nor Path 1 is acceptable, accept the status quo:
- Use squash-merge PRs from dev to main.
- `git diff --stat origin/main origin/dev` remains EMPTY after each sync.
- Topology stays divergent by design (the old §4.4 model).

This is what AGENTS.md §4.4 documented pre-homologation. It works but
doesn't satisfy the user's "branches must be homologated" goal.

## Decision

User chose **Path 0 (admin task — deferred)** as the *eventual* goal but
**Path A (squash-merge via PR)** as the *immediate* action to homologate
content. Path 0 remains pending (B27 admin task: ruleset relaxation via
GitHub UI). Path A is now in progress.

### Approval — Path A (squash-merge dev → main)

Per AGENTS.md §4.6, the agent MUST obtain explicit developer approval
before opening or merging a `dev → main` PR.

**Approval 1 (open PR)**: granted 2026-08-04 via `question` tool.
User selected: "Sí, aprueba — homologar contenido con squash-merge".

> promotion-approved-by: @ahincho on 2026-08-04 via chat

**Approval 2 (merge PR)**: PENDING. Will be requested after CI passes
and the agent re-confirms the diff.

## In-progress actions

1. Agent opens PR `dev → main` with squash-merge strategy.
2. CI runs (12+ jobs from `ci.yml`; CodeQL from `codeql.yml`).
3. Agent shows CI status to developer.
4. **PAUSE** — agent uses `question` tool for Approval 2.
5. If approved: merge via `gh pr merge --squash --admin --delete-branch`.
6. Agent verifies `git diff --stat origin/main origin/dev` = EMPTY.
7. Agent updates this audit doc with completion timestamp.
8. Agent records `promotion-approved-by: @<handle> on YYYY-MM-DD via chat`
   in the commit body.

## Pending admin task (B27)

Path 0 (force-push dev:main) still requires ruleset relaxation. The
agent has admin permissions on the repo (`gh api /repos/.../collaborators/ahincho/permission`
returns `admin: true`) but cannot modify org-level rulesets via the
free-plan GitHub API. The user has accepted ownership of this task.

Steps for the user (deferred):

1. Open https://github.com/spark-match/spark-match-03-backend/rules
2. Identify the ruleset that applies "no force-push + linear history + PR-only" to `main`.
3. Either temporarily disable the ruleset, or modify it to allow force-pushes by admins.
4. Notify the agent to execute `git push origin dev:main --force-with-lease`.
5. Re-enable / re-tighten the ruleset.
6. Verify post-push state: `git diff --stat origin/main origin/dev` = EMPTY, both `git log` divergence commands = EMPTY.

## Sprint 9 homologation context

This is part of the broader Sprint 9 close-out (Sprints 4-9). The
Sprint 9 sync PR #141 (`c12b23a`) brought Sprints 4-9 work to `main`
using the squash-merge workflow. PR #151 added the deferred-binding
audit doc to `dev` after the Sprint 9 sync.

Homologation is the cleanup phase: replace the squash-merge topology
with a linear topology so `main` and `dev` are mirror images.

## Refs

- AGENTS.md §4.3, §4.4, §4.5, §4.6 (new — promotion governance).
- GitHub ruleset: https://github.com/spark-match/spark-match-03-backend/rules
- Backup branch: `backup-main-pre-linearize` (commit `c12b23a`).
- SonarCloud binding fix audit (sibling deferred task):
  `docs/audits/sonarcloud-binding-fix-2026-08-04.md`.
- PR #141: Sprint 9 sync to main.
- PR #151: SonarCloud binding audit doc.
- PR #152 (pending): AGENTS.md update for promotion governance.
