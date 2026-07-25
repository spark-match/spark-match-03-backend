// =============================================================================
// AWS error mapping wrapper
// =============================================================================
// Wrap a call to AWS (SSM, Secrets Manager, EventBridge, ...) so any thrown
// error is surfaced as ApiError.awsUnavailable (code: aws.unavailable,
// meta.dependency). Already-typed ApiErrors are re-thrown unchanged so
// application-level errors propagate to the handler unchanged.
// =============================================================================

import { ApiError } from '../http/api-error.js';

/**
 * Execute an AWS operation and map any thrown error to ApiError.awsUnavailable.
 *
 * `dependency` is a human-readable identifier (e.g. "Secrets Manager", "SSM",
 * "EventBridge") included in the ErrorDetail meta so logs and clients can
 * pinpoint the failing upstream without exposing the AWS API name.
 */
export async function withAwsErrorMapping<T>(
  dependency: string,
  fn: () => Promise<T>,
): Promise<T> {
  try {
    return await fn();
  } catch (err) {
    if (err instanceof ApiError) throw err;
    throw ApiError.awsUnavailable(dependency, err);
  }
}
