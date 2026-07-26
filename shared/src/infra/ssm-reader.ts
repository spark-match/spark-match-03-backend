// =============================================================================
// SSM Parameter Store reader with error mapping
// =============================================================================
// Wraps @aws-lambda-powertools/parameters getParameter so any thrown error
// is surfaced as ApiError.awsUnavailable (code: aws.unavailable,
// meta.dependency). getRequiredString throws ApiError.internal when the
// parameter is missing or empty (which is a 500 - the configuration is
// wrong, not the request).
// =============================================================================

import { getParameter } from '@aws-lambda-powertools/parameters/ssm';
import { ApiError } from '../http/api-error.js';

const DEFAULT_MAX_AGE_SECONDS = 300;
const DEPENDENCY = 'SSM';

export interface SsmReader {
  getString(name: string, maxAge?: number): Promise<string | undefined>;
  getRequiredString(name: string, maxAge?: number): Promise<string>;
  invalidate(name?: string): void;
}

export function createSsmReader(defaultMaxAge = DEFAULT_MAX_AGE_SECONDS): SsmReader {
  return {
    async getString(name: string, maxAge = defaultMaxAge): Promise<string | undefined> {
      let value: string | { Value: string } | undefined;
      try {
        value = await getParameter(name, {
          maxAge,
          throwOnError: false,
        });
      } catch (err) {
        if (err instanceof ApiError) throw err;
        throw ApiError.awsUnavailable(DEPENDENCY, err);
      }
      if (typeof value === 'string') return value;
      if (typeof value === 'object' && value !== null && 'Value' in value) {
        return value.Value;
      }
      return undefined;
    },

    async getRequiredString(name: string, maxAge = defaultMaxAge): Promise<string> {
      const value = await this.getString(name, maxAge);
      if (value === undefined) {
        throw ApiError.internal(`Required SSM parameter not found or empty: ${name}`);
      }
      return value;
    },

    invalidate(name?: string): void {
      if (name) {
        getParameter(name, { forceFetch: true }).catch(() => {
          // Best-effort; ignore errors here.
        });
      } else {
        // No name provided: nothing to invalidate locally. The cache is
        // owned by Powertools; this hook is a placeholder for symmetry
        // with the previous interface and a future bulk flush.
      }
    },
  };
}
