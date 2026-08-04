# Security Policy

## Reporting a vulnerability

The Spark Match backend team takes security seriously. We
appreciate responsible disclosure and will work with you to
understand and resolve the issue.

### How to report

Email **security@spark-match.dev** with the following:

- A clear description of the vulnerability and its impact.
- Reproduction steps (proof-of-concept preferred over screenshots).
- Affected versions / commit SHAs.
- Your timezone and a contact window for follow-up.

**Do not** open a public GitHub issue for security-relevant
findings. Public disclosure before a fix is shipped exposes users
and complicates the response.

### What to expect

| Step | Window |
|---|---|
| Acknowledgement | within 2 business days |
| Triage + initial assessment | within 5 business days |
| Patch in `dev` (or private fork if exploit is live) | within 14 days for HIGH/CRITICAL |
| Public CVE/advisory (if applicable) | coordinated with reporter |

We follow GitHub Security Advisories for tracked disclosures.
Severity is assessed using CVSS 3.1.

## Supported versions

| Branch | Status |
|---|---|
| `dev` | active development, patches within SLA |
| `main` | latest release, patches within SLA |
| tags older than latest minor | not patched |

If you are running a tag older than `latest`, upgrade first and
verify before reporting.

## In-scope

- The code in this repo (`spark-match-03-backend`).
- Lambda functions, layers, SAM templates, CI/CD workflows.
- IAM roles provisioned by `spark-match-02-infrastructure` for
  this repo's deploys (see `02-infrastructure/docs/IAM_ROLES.md`).
- OIDC trust policies and the `sub` claim pattern
  `repo:spark-match/spark-match-03-backend:environment:<env>`.

## Out-of-scope

- Issues in third-party libraries that have not yet been adopted
  upstream (use Dependabot on `main` / `dev` to see live alerts).
- Vulnerabilities that require physical access to the AWS account,
  Identity Center, or container host.
- Rate-limiting / DoS that requires authentication tokens obtained
  by other means.
- Social engineering of maintainers.

## Hardening notes

- All inbound HTTP is over `https://` only (HTTP API v2 with JWT
  authorizer, AGENTS.md §1).
- JWT signing keys live in AWS Secrets Manager (SSM
  `/{env}/identity/jwt-secret`); rotation is documented in
  `docs/runbook.md`.
- All Lambda VPC / IAM changes go through `spark-match-02-infrastructure`
  PRs and are reviewed against `DOC/`.

## Acknowledgements

We credit reporters in the published advisory unless asked to
remain anonymous.
