export enum ErrorCode {
  VALIDATION_ERROR = 'VALIDATION_ERROR',
  UNAUTHORIZED = 'UNAUTHORIZED',
  FORBIDDEN = 'FORBIDDEN',
  NOT_FOUND = 'NOT_FOUND',
  CONFLICT = 'CONFLICT',
  INTERNAL_ERROR = 'INTERNAL_ERROR',
  SERVICE_UNAVAILABLE = 'SERVICE_UNAVAILABLE',
  RATE_LIMITED = 'RATE_LIMITED',
}

export class ApiError extends Error {
  override readonly name = 'ApiError';
  readonly statusCode: number;
  readonly code: ErrorCode;
  readonly details?: Record<string, unknown> | undefined;

  constructor(
    message: string,
    statusCode: number,
    code: ErrorCode,
    details?: Record<string, unknown>,
  ) {
    super(message);
    this.statusCode = statusCode;
    this.code = code;
    this.details = details;
  }

  static badRequest(message: string, details?: Record<string, unknown>): ApiError {
    return new ApiError(message, 400, ErrorCode.VALIDATION_ERROR, details);
  }

  static unauthorized(message = 'Unauthorized'): ApiError {
    return new ApiError(message, 401, ErrorCode.UNAUTHORIZED);
  }

  static forbidden(message = 'Forbidden'): ApiError {
    return new ApiError(message, 403, ErrorCode.FORBIDDEN);
  }

  static notFound(resource: string): ApiError {
    return new ApiError(`${resource} not found`, 404, ErrorCode.NOT_FOUND);
  }

  static conflict(message: string): ApiError {
    return new ApiError(message, 409, ErrorCode.CONFLICT);
  }

  static internal(message = 'Internal server error'): ApiError {
    return new ApiError(message, 500, ErrorCode.INTERNAL_ERROR);
  }

  static serviceUnavailable(service: string): ApiError {
    return new ApiError(`${service} is unavailable`, 503, ErrorCode.SERVICE_UNAVAILABLE);
  }
}
