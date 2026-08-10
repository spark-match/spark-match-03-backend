// =============================================================================
// ApiError - typed HTTP error with structured ErrorDetail[] and factories
// =============================================================================
// All thrown errors in handlers should be (or wrap) an ApiError. The
// buildHandler pipeline reads `.statusCode` and `.details` to produce the
// JSON envelope. Every ApiError carries at least one ErrorDetail: factories
// that accept `details` may receive either a single ErrorDetail or an array
// (normalized internally), and when no details are supplied a synthetic one
// is generated from the top-level code + message so the contract
// `details.length >= 1` always holds.
// =============================================================================

import type { $ZodIssue } from 'zod/v4/core';
import type { ErrorDetail } from './error-detail.js';

export type ApiErrorCode =
  | 'bad_request'
  | 'unauthorized'
  | 'forbidden'
  | 'not_found'
  | 'conflict'
  | 'unprocessable_entity'
  | 'too_many_requests'
  | 'internal'
  | 'service_unavailable';

export interface ApiErrorOptions {
  code?: ApiErrorCode;
  /** Single detail or array. Always normalized to non-empty array internally. */
  details?: ErrorDetail | ErrorDetail[];
  cause?: unknown;
}

export class ApiError extends Error {
  public readonly statusCode: number;
  public readonly code: ApiErrorCode;
  /** Always at least one entry (synthetic fallback when none provided). */
  public readonly details: ErrorDetail[];
  public override readonly cause: unknown;

  constructor(statusCode: number, message: string, options: ApiErrorOptions = {}) {
    super(message);
    this.name = 'ApiError';
    this.statusCode = statusCode;
    this.code = options.code ?? defaultCodeForStatus(statusCode);
    this.details = normalizeDetails(options.details, this.code, message);
    this.cause = options.cause;
  }

  // ---------------------------------------------------------------------------
  // HTTP-aligned factories. Use these for generic status codes when no
  // domain-specific factory fits.
  // ---------------------------------------------------------------------------

  static badRequest(message: string, details?: ErrorDetail | ErrorDetail[]): ApiError {
    return new ApiError(400, message, { code: 'bad_request', details });
  }

  static unauthorized(message = 'Unauthorized', details?: ErrorDetail | ErrorDetail[]): ApiError {
    return new ApiError(401, message, { code: 'unauthorized', details });
  }

  static forbidden(message = 'Forbidden', details?: ErrorDetail | ErrorDetail[]): ApiError {
    return new ApiError(403, message, { code: 'forbidden', details });
  }

  static notFound(resource: string): ApiError {
    return new ApiError(404, `${resource} not found`, { code: 'not_found' });
  }

  static conflict(message: string, details?: ErrorDetail | ErrorDetail[]): ApiError {
    return new ApiError(409, message, { code: 'conflict', details });
  }

  static unprocessable(message: string, details?: ErrorDetail | ErrorDetail[]): ApiError {
    return new ApiError(422, message, { code: 'unprocessable_entity', details });
  }

  static tooManyRequests(
    message = 'Too many requests',
    details?: ErrorDetail | ErrorDetail[],
  ): ApiError {
    return new ApiError(429, message, { code: 'too_many_requests', details });
  }

  static internal(message = 'Internal server error', cause?: unknown): ApiError {
    return new ApiError(500, message, { code: 'internal', cause });
  }

  static serviceUnavailable(message = 'Service unavailable'): ApiError {
    return new ApiError(503, message, { code: 'service_unavailable' });
  }

  // ---------------------------------------------------------------------------
  // Domain factories. Prefer these over raw constructor calls for business
  // errors so clients can dispatch on the granular `code` rather than
  // parsing messages.
  // ---------------------------------------------------------------------------

  /** Build a single ErrorDetail for field-level validation/business errors. */
  static fieldError(code: string, message: string, path?: string, value?: unknown): ErrorDetail {
    return {
      code,
      message,
      ...(path !== undefined ? { path } : {}),
      ...(value !== undefined ? { value } : {}),
    };
  }

  /** 409 - Email already registered. */
  static emailTaken(email: string): ApiError {
    return ApiError.conflict('Email already registered', {
      code: 'user.email_taken',
      message: 'A user with this email already exists',
      path: 'email',
      value: email,
    });
  }

  /** 404 - User not found. */
  static userNotFound(): ApiError {
    return ApiError.notFound('User');
  }

  /** 401 - Invalid credentials (generic message to avoid leaking which field was wrong). */
  static invalidCredentials(): ApiError {
    return ApiError.unauthorized('Invalid credentials');
  }

  /** 503 - Upstream AWS dependency failure (SSM, Secrets Manager, EventBridge, ...). */
  static awsUnavailable(dependency: string, cause?: unknown): ApiError {
    return new ApiError(503, `${dependency} is unavailable`, {
      details: {
        code: 'aws.unavailable',
        message: `${dependency} is unavailable`,
        meta: { dependency },
      },
      cause,
    });
  }

  /** 503 - Database failure. `operation` describes the attempted action (select, insert, ...). */
  static dbUnavailable(operation: string, cause?: unknown): ApiError {
    return new ApiError(503, 'Database is unavailable', {
      details: {
        code: 'db.unavailable',
        message: 'Database is unavailable',
        meta: { operation },
      },
      cause,
    });
  }

  /** Convert Zod issues into a 400 ApiError with one ErrorDetail per issue. */
  static fromZodError(
    error: { issues: $ZodIssue[] },
    fallbackMessage = 'Validation failed',
  ): ApiError {
    const details: ErrorDetail[] = error.issues.map((issue) => ({
      code: `validation.${issue.code}`,
      message: issue.message,
      path: issue.path.join('.'),
    }));
    return ApiError.badRequest(fallbackMessage, details);
  }
}

function defaultCodeForStatus(statusCode: number): ApiErrorCode {
  switch (statusCode) {
    case 400:
      return 'bad_request';
    case 401:
      return 'unauthorized';
    case 403:
      return 'forbidden';
    case 404:
      return 'not_found';
    case 409:
      return 'conflict';
    case 422:
      return 'unprocessable_entity';
    case 429:
      return 'too_many_requests';
    case 503:
      return 'service_unavailable';
    default:
      return 'internal';
  }
}

function normalizeDetails(
  details: ErrorDetail | ErrorDetail[] | undefined,
  fallbackCode: string,
  fallbackMessage: string,
): ErrorDetail[] {
  if (details === undefined) {
    return [{ code: fallbackCode, message: fallbackMessage }];
  }
  return Array.isArray(details) ? details : [details];
}
