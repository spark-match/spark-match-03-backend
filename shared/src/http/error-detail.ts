// =============================================================================
// ErrorDetail - structured detail for ApiError and ErrorEnvelope
// =============================================================================
// Every ApiError carries an `ErrorDetail[]` (always at least one entry) and
// the response envelope surfaces it under `error.details`. Codes follow a
// dotted taxonomy so clients can dispatch on them without parsing messages:
//
//   validation.*  - request payload failed schema validation (Zod)
//   auth.*        - authentication / authorization failure
//   user.*        - business rules on users (self-* rules, duplicates, ...)
//   aws.*         - upstream AWS (SSM, Secrets Manager, EventBridge) failure
//   db.*          - downstream database failure
//   internal.*    - unexpected server-side errors
//
// SAFETY: `value` MUST NOT contain secrets (passwords, tokens, refresh
// tokens, signing keys) nor sensitive PII beyond what is strictly required
// for the client to render an actionable error.
// =============================================================================

export interface ErrorDetail {
  /** Stable, machine-readable code (e.g. "validation.invalid_type"). */
  code: string;
  /** Human-readable, English description safe to surface to the client. */
  message: string;
  /** Dotted field path for validation/business errors (e.g. "address.city"). */
  path?: string;
  /** Offending value. NEVER passwords, tokens, or sensitive PII. */
  value?: unknown;
  /** Additional structured context (e.g. expected vs received type). */
  meta?: Record<string, unknown>;
}
