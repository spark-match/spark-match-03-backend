# CodeQL config exclusion limitation — 2026-08-04

## TL;DR

The CodeQL config-file exclusion added in PR #140 (mirroring the one in
`01-devops/.github/codeql/codeql-config.yml`) was confirmed via direct
log inspection on 2026-08-04 to be **parsed but ineffective** in the
current toolchain: CodeQL CLI v2.26.2 + `actions-queries` v0.6.32 (via
`github/codeql-action/init@v4.37.4`) **still evaluates** the excluded
`UnpinnedActionsTag.ql` query and emits SARIF alerts.

A workaround attempt (PR #162, declaring `queries: - uses: security-extended`
in the config so the workflow's `queries:` input becomes a no-op) **did not
change the behaviour** — same log evidence, query still evaluated.

The operative defence at the repo level is `tests/bats/no-sha-pinning.bats`
(PR #138), which rejects SHA-pinned uses in workflows at PR-time.

The 3 standing `actions/unpinned-tag` alerts on `.github/workflows/deploy.yml`
were manually dismissed as `won't fix` with justifications referencing
§10.1 (cross-repo reusable pinning), §12.1 (third-party `@vN` pinning), and
§13 B26 (known standing alerts).

---

## Reproduction

### Symptom

`actions/unpinned-tag` alerts accumulate on every push to `main` and `dev`
even though `.github/codeql/codeql-config.yml` declares the exclusion:

```yaml
query-filters:
  - exclude:
      id: actions/unpinned-tag
      reason: ...
```

### Evidence

CodeQL run logs from spark-match-03-backend run 30929134877 (2026-08-04
16:26 UTC, push to `main` after PR #161 sync):

```
codeql-analyze / analyze-actions   ...
  config-file: .github/codeql/codeql-config.yml
  ...
query-filters:
  - exclude:
  - exclude:
[18/24] Loaded /opt/hostedtoolcache/CodeQL/2.26.2/x64/codeql/qlpacks/
         codeql/actions-queries/0.6.32/Security/CWE-829/UnpinnedActionsTag.qlx.
Starting evaluation of codeql/actions-queries/Security/CWE-829/UnpinnedActionsTag.ql
[24/24 eval 208ms] Evaluation done; writing results to UnpinnedActionsTag.bqrs.
Interpreting UnpinnedActionsTag.ql ...
Interpreted problem query "Unpinned tag for a non-immutable Action in
workflow or composite action" (actions/unpinned-tag) ...
```

Both `query-filters` entries (`id: js/actions/unpinned-3rd-party-action`
and `id: actions/unpinned-tag`) are echoed back from the resolved config
— the YAML is parsed correctly. But the excluded query still runs and
writes a SARIF result, which surfaces as a GitHub code-scanning alert.

### Cross-repo confirmation

Same symptom on spark-match-01-devops (which has the same exclusion
syntax in `.github/codeql/codeql-config.yml`):

- 21 standing `actions/unpinned-tag` alerts on 2026-08-04
- Same CodeQL toolchain (v2.26.2 + actions-queries v0.6.32)
- Same exclusion syntax

### Workaround attempt (PR #162, closed)

Added `queries: - uses: security-extended` to the config so the workflow's
`queries: security-extended` input becomes a no-op (per docs: "any additional
packs or queries specified in your workflow are used instead of those
specified in the configuration file"). Hypothesis: when the config-file
itself declares the suite, the action loads the suite definition from the
config and the workflow's queries input has no effect, which might let the
query-filters exclude actually take effect.

Result from PR #162 CI logs (run 30932083898):

```
queries:
  - uses: security-extended
query-filters:
[16/24] Loaded UnpinnedActionsTag.qlx.
Starting evaluation of UnpinnedActionsTag.ql
```

Same outcome. Query still evaluated, alert still emitted. PR #162 closed
as not-effective.

---

## Root cause hypothesis

CodeQL CLI v2.26.2's `query-filters` `exclude` directive appears to
filter query results post-evaluation rather than skip evaluation
entirely, at least for the `actions/unpinned-tag` query. This may be:

1. A bug in the CLI's filter pipeline for the actions language.
2. A change in semantics between CLI versions (newer CLI may have
   different behaviour than what older docs describe).
3. A documented limitation that the docs do not surface clearly.

This is consistent with upstream issues (e.g.
[codeql-cli#2739](https://github.com/github/codeql-cli/issues/2739))
but no definitive bug report has been filed at the time of this audit.

---

## Manual dismissals (2026-08-04)

| Alert | Resource | Dismissal reason | Justification |
|---|---|---|---|
| #6 | `spark-match-01-devops/.../reusable-node-build.yml@main` at deploy.yml:93 | won't fix | §10.1 mandates `@main` for `01-devops` reusables; SHA-pinning forbidden by `tests/bats/no-sha-pinning.bats` (PR #138); bats test is the operative defense. |
| #8 | `aws-actions/setup-sam@v3` at deploy.yml:79 | won't fix | §12.1 mandates `@vN` for third-party actions; SHA-pinning forbidden by bats test (PR #138); bumped from `@v2` by Dependabot #143. |
| #9 | `aws-actions/configure-aws-credentials@v6` at deploy.yml:113 | won't fix | §12.1 mandates `@vN` for third-party actions; SHA-pinning forbidden by bats test (PR #138); bumped from `@v4` by Dependabot #145. |

All 3 alerts dismissed via `PATCH /repos/.../code-scanning/alerts/{n}`
with `state=dismissed`, `dismissed_reason="won't fix"`. The
`dismissed_comment` field could not be set because (a) it has a 280-char
limit and (b) the API rejects updates to already-dismissed alerts.

Detailed justifications live in PR #140 description, this audit doc,
and AGENTS.md §13 B26.

---

## Operative defense

`tests/bats/no-sha-pinning.bats` (PR #138) is the operative repo-level
control. It parses every workflow file under `.github/workflows/`,
extracts every `uses: <action>@<ref>` line, and fails the structural
test if any ref is a 40-character SHA hash. This rejects SHA-pinning
attempts at PR-time, before any CodeQL scan runs.

The bats test is exercised in CI as part of the `codeql-config` job and
in local pre-push hooks.

---

## Outstanding items

- **Upstream fix** (out of scope for this repo, owned by `01-devops` or
  `codeql`): file a bug against `github/codeql-cli` and
  `github/codeql-action` documenting that `query-filters: exclude: id`
  does not prevent query evaluation for the `actions` language pack
  in CLI v2.26.2.
- **Future CodeQL version**: when `01-devops` upgrades to a CodeQL CLI
  version that honours `query-filters` properly, the config-file
  exclusion in `.github/codeql/codeql-config.yml` will become effective
  without further changes to this repo. PR #140's `config-file:` forwarding
  is still useful for that eventuality.
- **Defensive workaround**: consider a `paths-ignore` on `deploy.yml` in
  the CodeQL config to suppress ALL findings on that workflow (not just
  unpinned-tag). This is a sledgehammer — it would hide other security
  findings on `deploy.yml` (e.g., workflow-injection patterns if
  introduced in the future). NOT recommended; would require justification
  in a separate PR.

---

## References

- AGENTS.md §6 (security alerts are P0, merge-blocking)
- AGENTS.md §10.1 (cross-repo reusable pinning to `@main`)
- AGENTS.md §12.1 (third-party action pinning to `@vN`)
- AGENTS.md §13 B26 (this audit doc)
- PR #140 (config-file forwarding via `reusable-codeql.yml` v1.1.0)
- PR #138 (bats no-sha-pinning structural test)
- PR #162 (workaround attempt, closed as not-effective)
- PR #143 (Dependabot: `aws-actions/setup-sam` v2 → v3)
- PR #145 (Dependabot: `aws-actions/configure-aws-credentials` v4 → v6)
- spark-match-01-devops/.github/codeql/codeql-config.yml (reference exclusion)
- spark-match-01-devops/.github/workflows/reusable-codeql.yml (v1.1.0 recipe)
- github/codeql-action v4.37.4 (`init` action accepts `config-file`)
- CodeQL CLI v2.26.2 (the version bundled with `codeql-action` v4.37.4)
- `actions-queries` v0.6.32 (the actions-language query pack)