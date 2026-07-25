import { describe, it, expect } from 'vitest';
import type { ZodIssue } from 'zod';
import { ApiError, type ErrorDetail } from './index.js';

describe('ApiError', () => {
  describe('static factories', () => {
    it('badRequest returns 400 with code bad_request and synthetic detail', () => {
      const err = ApiError.badRequest('Invalid input');
      expect(err.statusCode).toBe(400);
      expect(err.code).toBe('bad_request');
      expect(err.message).toBe('Invalid input');
      expect(err.details).toEqual([{ code: 'bad_request', message: 'Invalid input' }]);
    });

    it('badRequest accepts a single ErrorDetail', () => {
      const detail: ErrorDetail = {
        code: 'validation.required',
        message: 'Email is required',
        path: 'email',
      };
      const err = ApiError.badRequest('Invalid input', detail);
      expect(err.details).toEqual([detail]);
    });

    it('badRequest accepts an ErrorDetail[]', () => {
      const details: ErrorDetail[] = [
        { code: 'validation.required', message: 'Email is required', path: 'email' },
        { code: 'validation.required', message: 'Password is required', path: 'password' },
      ];
      const err = ApiError.badRequest('Invalid input', details);
      expect(err.details).toEqual(details);
    });

    it('unauthorized returns 401 with default message and synthetic detail', () => {
      const err = ApiError.unauthorized();
      expect(err.statusCode).toBe(401);
      expect(err.code).toBe('unauthorized');
      expect(err.message).toBe('Unauthorized');
      expect(err.details).toEqual([{ code: 'unauthorized', message: 'Unauthorized' }]);
    });

    it('unauthorized accepts custom message', () => {
      const err = ApiError.unauthorized('Token expired');
      expect(err.message).toBe('Token expired');
      expect(err.details).toEqual([{ code: 'unauthorized', message: 'Token expired' }]);
    });

    it('forbidden returns 403 with default message and synthetic detail', () => {
      const err = ApiError.forbidden();
      expect(err.statusCode).toBe(403);
      expect(err.code).toBe('forbidden');
      expect(err.message).toBe('Forbidden');
      expect(err.details).toEqual([{ code: 'forbidden', message: 'Forbidden' }]);
    });

    it('notFound returns 404 with resource name', () => {
      const err = ApiError.notFound('User');
      expect(err.statusCode).toBe(404);
      expect(err.code).toBe('not_found');
      expect(err.message).toBe('User not found');
      expect(err.details).toEqual([{ code: 'not_found', message: 'User not found' }]);
    });

    it('conflict returns 409 with details', () => {
      const detail: ErrorDetail = {
        code: 'user.email_taken',
        message: 'A user with this email already exists',
        path: 'email',
      };
      const err = ApiError.conflict('Duplicate email', detail);
      expect(err.statusCode).toBe(409);
      expect(err.code).toBe('conflict');
      expect(err.details).toEqual([detail]);
    });

    it('conflict returns 409 without details (synthetic)', () => {
      const err = ApiError.conflict('Duplicate email');
      expect(err.statusCode).toBe(409);
      expect(err.code).toBe('conflict');
      expect(err.details).toEqual([{ code: 'conflict', message: 'Duplicate email' }]);
    });

    it('unprocessable returns 422 with details', () => {
      const err = ApiError.unprocessable('Validation failed', {
        code: 'validation.invalid_type',
        message: 'Expected number, got string',
        path: 'age',
      });
      expect(err.statusCode).toBe(422);
      expect(err.code).toBe('unprocessable_entity');
    });

    it('tooManyRequests returns 429 with default message', () => {
      const err = ApiError.tooManyRequests();
      expect(err.statusCode).toBe(429);
      expect(err.code).toBe('too_many_requests');
    });

    it('internal returns 500 with cause', () => {
      const cause = new Error('db down');
      const err = ApiError.internal('Something went wrong', cause);
      expect(err.statusCode).toBe(500);
      expect(err.code).toBe('internal');
      expect(err.cause).toBe(cause);
    });

    it('serviceUnavailable returns 503 with default message', () => {
      const err = ApiError.serviceUnavailable();
      expect(err.statusCode).toBe(503);
      expect(err.code).toBe('service_unavailable');
    });
  });

  describe('domain factories', () => {
    it('fieldError returns an ErrorDetail', () => {
      const detail = ApiError.fieldError('validation.required', 'Email required', 'email');
      expect(detail).toEqual({
        code: 'validation.required',
        message: 'Email required',
        path: 'email',
      });
    });

    it('fieldError with value includes it', () => {
      const detail = ApiError.fieldError('validation.too_small', 'Min 8', 'password', 'short');
      expect(detail.value).toBe('short');
    });

    it('emailTaken returns 409 with user.email_taken detail', () => {
      const err = ApiError.emailTaken('a@b.com');
      expect(err.statusCode).toBe(409);
      expect(err.code).toBe('conflict');
      expect(err.details).toEqual([
        {
          code: 'user.email_taken',
          message: 'A user with this email already exists',
          path: 'email',
          value: 'a@b.com',
        },
      ]);
    });

    it('userNotFound returns 404', () => {
      const err = ApiError.userNotFound();
      expect(err.statusCode).toBe(404);
      expect(err.code).toBe('not_found');
      expect(err.message).toBe('User not found');
    });

    it('invalidCredentials returns 401 with generic message', () => {
      const err = ApiError.invalidCredentials();
      expect(err.statusCode).toBe(401);
      expect(err.code).toBe('unauthorized');
      expect(err.message).toBe('Invalid credentials');
    });

    it('awsUnavailable returns 503 with aws.unavailable detail and cause', () => {
      const cause = new Error('AccessDenied');
      const err = ApiError.awsUnavailable('Secrets Manager', cause);
      expect(err.statusCode).toBe(503);
      expect(err.code).toBe('service_unavailable');
      expect(err.cause).toBe(cause);
      expect(err.details).toEqual([
        {
          code: 'aws.unavailable',
          message: 'Secrets Manager is unavailable',
          meta: { dependency: 'Secrets Manager' },
        },
      ]);
    });

    it('dbUnavailable returns 503 with db.unavailable detail and operation meta', () => {
      const cause = new Error('connection refused');
      const err = ApiError.dbUnavailable('select', cause);
      expect(err.statusCode).toBe(503);
      expect(err.code).toBe('service_unavailable');
      expect(err.cause).toBe(cause);
      expect(err.details).toEqual([
        {
          code: 'db.unavailable',
          message: 'Database is unavailable',
          meta: { operation: 'select' },
        },
      ]);
    });

    it('fromZodError converts issues to validation.* ErrorDetail[]', () => {
      const zodError = {
        issues: [
          { code: 'invalid_type', path: ['email'], message: 'Expected string' },
          { code: 'too_small', path: ['age'], message: 'Must be >= 0' },
        ],
      } as unknown as { issues: ZodIssue[] };
      const err = ApiError.fromZodError(zodError, 'Invalid payload');
      expect(err.statusCode).toBe(400);
      expect(err.code).toBe('bad_request');
      expect(err.message).toBe('Invalid payload');
      expect(err.details).toEqual([
        { code: 'validation.invalid_type', message: 'Expected string', path: 'email' },
        { code: 'validation.too_small', message: 'Must be >= 0', path: 'age' },
      ]);
    });
  });

  describe('instance', () => {
    it('extends Error and sets name', () => {
      const err = ApiError.badRequest('test');
      expect(err).toBeInstanceOf(Error);
      expect(err.name).toBe('ApiError');
    });
  });

  describe('defaultCodeForStatus', () => {
    it.each([
      [400, 'bad_request'],
      [401, 'unauthorized'],
      [403, 'forbidden'],
      [404, 'not_found'],
      [409, 'conflict'],
      [422, 'unprocessable_entity'],
      [429, 'too_many_requests'],
      [503, 'service_unavailable'],
    ])('maps %i to %s', (status, expected) => {
      expect(new ApiError(status, 'msg').code).toBe(expected);
    });

    it('maps unknown status to internal', () => {
      expect(new ApiError(500, 'msg').code).toBe('internal');
      expect(new ApiError(418, 'msg').code).toBe('internal');
    });

    it('preserves explicit code override', () => {
      const err = new ApiError(400, 'msg', { code: 'internal' });
      expect(err.code).toBe('internal');
    });
  });
});
