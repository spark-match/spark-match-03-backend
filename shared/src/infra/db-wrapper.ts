// =============================================================================
// DB error mapping wrapper
// =============================================================================
// Wrap a kysely/node-postgres call so any thrown error is surfaced as
// ApiError.dbUnavailable (code: db.unavailable, meta.operation). Already-
// typed ApiErrors are re-thrown unchanged so application-level errors
// (notFound, conflict, ...) propagate to the handler unchanged.
// =============================================================================

import { ApiError } from '../http/api-error.js';

/**
 * Execute a DB operation and map any thrown error to ApiError.dbUnavailable.
 *
 * `operation` is a short machine-readable identifier (e.g. "users.findById",
 * "assignments.updateStatus") included in the ErrorDetail meta so logs and
 * clients can pinpoint the failing query without exposing SQL.
 */
export async function withDbErrorMapping<T>(operation: string, fn: () => Promise<T>): Promise<T> {
  try {
    return await fn();
  } catch (err) {
    if (err instanceof ApiError) throw err;
    throw ApiError.dbUnavailable(operation, err);
  }
}
