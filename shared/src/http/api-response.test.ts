import { describe, it, expect } from 'vitest';
import { formatError, formatResponse } from './api-response.js';
import { ApiError } from './api-error.js';

describe('formatResponse', () => {
  it('wraps data with success envelope', () => {
    const result = formatResponse({ id: 'u-1', email: 'a@b.com' }, 'req-123');
    expect(result.success).toBe(true);
    expect(result.data).toEqual({ id: 'u-1', email: 'a@b.com' });
    expect(result.meta.requestId).toBe('req-123');
    expect(result.meta.timestamp).toMatch(/^\d{4}-\d{2}-\d{2}T/);
  });
});

describe('formatError', () => {
  it('formats ApiError with code and structured details', () => {
    const err = ApiError.badRequest('Invalid email', {
      code: 'validation.invalid_type',
      message: 'Expected string',
      path: 'email',
    });
    const result = formatError(err, 'req-456');
    expect(result.success).toBe(false);
    expect(result.error.code).toBe('bad_request');
    expect(result.error.message).toBe('Invalid email');
    expect(result.error.details).toEqual([
      { code: 'validation.invalid_type', message: 'Expected string', path: 'email' },
    ]);
    expect(result.meta.requestId).toBe('req-456');
  });

  it('always includes details field even when ApiError has no explicit details (synthetic fallback)', () => {
    const err = ApiError.unauthorized();
    const result = formatError(err, 'req-abc');
    expect(result.error.code).toBe('unauthorized');
    expect(result.error.details).toEqual([{ code: 'unauthorized', message: 'Unauthorized' }]);
  });

  it('hides internal error details from unknown errors and surfaces internal.unknown code', () => {
    const err = new Error('DB password leaked here');
    const result = formatError(err, 'req-789');
    expect(result.success).toBe(false);
    expect(result.error.code).toBe('internal');
    expect(result.error.message).toBe('Internal server error');
    expect(result.error.details).toEqual([
      { code: 'internal.unknown', message: 'Internal server error' },
    ]);
  });

  it('serializes to a stable shape regardless of synthetic vs explicit details', () => {
    const withDetails = formatError(ApiError.emailTaken('a@b.com'), 'req-1');
    const withoutDetails = formatError(ApiError.unauthorized(), 'req-2');
    expect(Object.keys(withDetails.error).sort()).toEqual(['code', 'details', 'message']);
    expect(Object.keys(withoutDetails.error).sort()).toEqual(['code', 'details', 'message']);
  });
});
