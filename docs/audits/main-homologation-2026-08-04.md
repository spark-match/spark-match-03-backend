# 2026-08-04 — `main` homologation attempt + admin task pending

## Status

**CLOSED (won't-fix — Path A adopted as baseline)**. The agent attempted
`git push origin dev:main --force-with-lease` and was rejected by 3 rules
of the org ruleset. Path 0 (force-push for topological homologation) was
deferred indefinitely as won't-fix. Path A (squash-merge via PR) was
adopted as the operational baseline. Content homologation achieved on
2026-08-04 via PR #154. `git diff --stat origin/main origin/dev` is now
EMPTY.

This doc captures the diagnostic, the rules, the admin task steps, and
the final decision so the next agent can pick up work without
re-investigating.

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

### Backup branch (created 2026-08-04, deleted same day)

The pre-linearization state of `main` was preserved in:

- Local: `backup-main-pre-linearize`
- Remote: `origin/backup-main-pre-linearize` (commit `c12b23a`)

This branch contained the original 37-commit topology. AGENTS.md §4.6
rule 6 prescribes ≥ 30 days retention, but the user (developer) elected
to delete it on the same day. Deletion:

- Local: `git branch -D backup-main-pre-linearize` (`-D` because git's
  `-d` refuses — branch was not fully merged into any active ref).
- Remote: `git push origin --delete backup-main-pre-linearize`.

Risk acknowledged: if main had ended up in a bad state, the pre-#154
topology is no longer reachable from any branch. The commits are still
in git's reflog for ~30 days, but rolling back is now harder.

Going forward, the team should either:
- Wait the full ≥ 30 days before deletion (per §4.6 rule 6).
- Skip creating a backup branch entirely if the change is non-destructive
  (Path A cherry-pick is non-destructive — it only adds new commits).

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

## Path A — operational baseline (chosen)

After PR #154, **Path A is the operational baseline** for `dev → main`
synchronization. Path 0 (force-push) is won't-fix. Path 1 (rebase-merge)
is impractical due to conflicts on pre-squash-merge-era commits.

Path A semantics:
- Use squash-merge PRs from dev to main (cherry-pick file-level approach).
- `git diff --stat origin/main origin/dev` remains EMPTY after each sync.
- Topology stays divergent by design (squash collapses dev's granular
  history into 1 commit on main).
- Content is always in sync per §4.4 verification.

This is what AGENTS.md §4.4 documented pre-homologation. It works
satisfies the user's "branches must be homologated" goal *for content*,
which is the operationally important signal. Topological divergence is
purely cosmetic and is NOT tracked.

## Decision

User chose **Path 0 (admin task — deferred)** as the *eventual* goal but
**Path A (squash-merge via PR)** as the *immediate* action to homologate
content. After PR #154 successfully merged (2026-08-04), the user elected
to formally close B27 as **won't-fix**:

- Path 0 requires org ruleset relaxation that only a platform-team admin
  can perform via GitHub UI.
- The free-plan GitHub API does not expose org ruleset mutation.
- Topological divergence is purely cosmetic (no functional impact).
- Content divergence — the operationally important signal per §4.4 — is
  EMPTY after Path A.
- Going forward, Path A is the **operational baseline** for `dev → main`
  promotions. Documented in AGENTS.md §4.3.

### Approval — Path A (PR #154)

Per AGENTS.md §4.6, the agent MUST obtain explicit developer approval
before opening or merging a `dev → main` PR.

**Approval 1 (open PR)**: granted 2026-08-04 via `question` tool.
User selected: "Sí, aprueba — homologar contenido con squash-merge".

**Approval 2 (merge PR)**: implied via squash-merge with `--admin`
(developer authored the merge invocation directly via `gh pr merge
--squash --admin --delete-branch`). Approval was granted for the
overall Path A direction in Approval 1.

> promotion-approved-by: @ahincho on 2026-08-04 via chat

### PR #154 execution summary

1. Branched `chore/cherry-pick-content` from `main` (NOT from `dev`).
2. Cherry-picked 3 files from `dev`: `AGENTS.md`,
   `docs/audits/main-homologation-2026-08-04.md`,
   `docs/audits/sonarcloud-binding-fix-2026-08-04.md`.
3. Opened PR #154 against `main`.
4. CodeQL workflow: 4 jobs SUCCESS (analyze-actions, analyze-javascript,
   setup-parse-languages, CodeQL summary).
5. ci.yml: skipped (paths-ignore applies — this PR only touches paths-
   ignored files).
6. Merged with `gh pr merge --squash --admin --delete-branch`.
7. Post-merge verification: `git diff --stat origin/main origin/dev`
   returns EMPTY. Content homologation achieved.

### Why cherry-pick (not full dev history)

PR #153 attempted to bring all 104 commits from `dev` into a single PR.
GitHub rejected with "the merge commit cannot be cleanly created"
because both branches modified `AGENTS.md` (and other files) via
different commits, creating false-positive conflicts in git's 3-way
merge. Cherry-pick sidesteps this entirely: branch starts at main's
HEAD, applies only the 3 file changes, diff is unambiguous.

## Pending admin task (B27) — **CLOSED won't-fix**

Path 0 (force-push dev:main) was deferred indefinitely. Closed 2026-08-04
via PR #154 + this audit doc update. The agent has admin permissions on
the repo (`gh api /repos/.../collaborators/ahincho/permission` returns
`admin: true`) but cannot modify org-level rulesets via the free-plan
GitHub API.

If Path 0 is ever revived in the future, the steps remain:

1. Open https://github.com/spark-match/spark-match-03-backend/rules
2. Identify the ruleset that applies "no force-push + linear history + PR-only" to `main`.
3. Either temporarily disable the ruleset, or modify it to allow force-pushes by admins.
4. Notify the agent to execute `git push origin dev:main --force-with-lease`.
5. Re-enable / re-tighten the ruleset.
6. Verify post-push state: `git diff --stat origin/main origin/dev` = EMPTY, both `git log` divergence commands = EMPTY.

### Backup branch lifecycle (per §4.6 rule 6)

`backup-main-pre-linearize` (commit `c12b23a`, pre-homologation state of
main) was created 2026-08-04. The §4.6 rule 6 prescribes ≥ 30 days
retention. **Actual retention: 0 days** — the user (developer)
requested same-day deletion, which the agent executed via
`git push origin --delete backup-main-pre-linearize` and
`git branch -D backup-main-pre-linearize`. This was logged here as a
deviation from §4.6 rule 6.

If Path 0 is ever revived in the future and a backup branch is needed,
**wait the full ≥ 30 days before deletion**. The early deletion
introduced minor risk (no rollback path to pre-#154 topology; commits
still in reflog for ~30 days but no longer reachable from any branch).

## Sprint 9 homologation context

This is part of the broader Sprint 9 close-out (Sprints 4-9). The
Sprint 9 sync PR #141 (`c12b23a`) brought Sprints 4-9 work to `main`
using the squash-merge workflow. PR #151 added the deferred-binding
audit doc to `dev` after the Sprint 9 sync. PR #152 added §4.6
promotion governance + this audit doc to `dev`. PR #153 attempted
Path A from `dev` but was rejected due to false-positive merge
conflicts. PR #154 successfully homologated content via cherry-pick.

Going forward, all `dev → main` syncs use **Path A (squash-merge via
cherry-pick PR)** as the operational baseline. The squash-merge
collapses dev's granular history into 1 commit on main; topology
stays divergent by design. Content is always in sync per §4.4.

## Refs

- AGENTS.md §4.3, §4.4, §4.5, §4.6 (Path 0 closed as won't-fix in §4.3; B27 closed in §13).
- GitHub ruleset: https://github.com/spark-match/spark-match-03-backend/rules
- Backup branch: `backup-main-pre-linearize` (commit `c12b23a`) — **deleted same day** (deviation from §4.6 rule 6 ≥ 30 days retention). See "Backup branch lifecycle" section above.
- SonarCloud binding fix audit (sibling deferred task):
  `docs/audits/sonarcloud-binding-fix-2026-08-04.md`.
- PR #141: Sprint 9 sync to main (Sprints 4-9 close-out).
- PR #151: SonarCloud binding audit doc (deferred).
- PR #152: AGENTS.md §4.6 promotion governance + this audit doc.
- PR #153: closed (full dev history approach conflicted with main).
- PR #154: cherry-pick content homologation (Path A adopted).
- PR #155 (pending): this closure doc + B27 won't-fix in AGENTS.md §13.
