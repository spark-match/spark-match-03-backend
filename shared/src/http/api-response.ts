import type { APIGatewayProxyResult } from 'aws-lambda';
import { ApiError, ErrorCode } from './api-error.js';
import { z } from 'zod';

export interface ApiResponseBody<T> {
  success: true;
  data: T;
  meta?: {
    requestId?: string;
    timestamp?: string;
  };
}

export interface ApiErrorBody {
  success: false;
  error: {
    code: string;
    message: string;
    details?: Record<string, unknown>;
  };
  meta?: {
    requestId?: string;
    timestamp?: string;
  };
}

export function formatResponse<T>(
  data: T,
  statusCode = 200,
  requestId?: string,
): APIGatewayProxyResult {
  const body: ApiResponseBody<T> = {
    success: true,
    data,
    meta: {
      timestamp: new Date().toISOString(),
      ...(requestId ? { requestId } : {}),
    },
  };

  return {
    statusCode,
    headers: {
      'Content-Type': 'application/json',
      'X-Content-Type-Options': 'nosniff',
      'X-Frame-Options': 'DENY',
    },
    body: JSON.stringify(body),
  };
}

export function formatError(
  err: unknown,
  requestId?: string,
): APIGatewayProxyResult {
  let statusCode = 500;
  let code: ErrorCode = ErrorCode.INTERNAL_ERROR;
  let message = 'Internal server error';
  let details: Record<string, unknown> | undefined;

  if (err instanceof ApiError) {
    statusCode = err.statusCode;
    code = err.code;
    message = err.message;
    details = err.details;
  } else if (err instanceof z.ZodError) {
    statusCode = 400;
    code = ErrorCode.VALIDATION_ERROR;
    message = 'Validation failed';
    details = {
      issues: err.issues.map((i) => ({
        path: i.path.join('.'),
        message: i.message,
        code: i.code,
      })),
    };
  } else if (err instanceof Error) {
    message = err.message;
  }

  const body: ApiErrorBody = {
    success: false,
    error: {
      code,
      message,
      ...(details ? { details } : {}),
    },
    meta: {
      timestamp: new Date().toISOString(),
      ...(requestId ? { requestId } : {}),
    },
  };

  return {
    statusCode,
    headers: {
      'Content-Type': 'application/json',
      'X-Content-Type-Options': 'nosniff',
      'X-Frame-Options': 'DENY',
    },
    body: JSON.stringify(body),
  };
}
