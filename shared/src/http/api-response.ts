// =============================================================================
// HTTP response envelope formatters
// =============================================================================
// Standard JSON envelope for all Spark Match API responses:
//   { success: true,  data: <payload>, meta: { requestId, timestamp } }
//   { success: false, error: { code, message, details[] }, meta: {...} }
//
// `error.details` is ALWAYS a non-empty ErrorDetail[] (synthetic when the
// originating error has no granular detail). The build-handler pipeline
// calls formatError(err) when an error is thrown; formatResponse is called
// on success. The `requestId` is REQUIRED on every envelope so the client
// has a stable correlation handle for support tickets.
// =============================================================================

import { ApiError } from './api-error.js';
import type { ErrorDetail } from './error-detail.js';

export interface ResponseMeta {
  requestId: string;
  timestamp: string;
}

export interface SuccessEnvelope<T> {
  success: true;
  data: T;
  meta: ResponseMeta;
}

export interface ErrorEnvelope {
  success: false;
  error: {
    code: string;
    message: string;
    /** Always present and non-empty. */
    details: ErrorDetail[];
  };
  meta: ResponseMeta;
}

export function formatResponse<T>(data: T, requestId: string): SuccessEnvelope<T> {
  return {
    success: true,
    data,
    meta: {
      requestId,
      timestamp: new Date().toISOString(),
    },
  };
}

export function formatError(err: unknown, requestId: string): ErrorEnvelope {
  const meta: ResponseMeta = {
    requestId,
    timestamp: new Date().toISOString(),
  };
  if (err instanceof ApiError) {
    return {
      success: false,
      error: {
        code: err.code,
        message: err.message,
        details: err.details,
      },
      meta,
    };
  }
  // Unknown error: do not leak internal details to the client.
  return {
    success: false,
    error: {
      code: 'internal',
      message: 'Internal server error',
      details: [{ code: 'internal.unknown', message: 'Internal server error' }],
    },
    meta,
  };
}
