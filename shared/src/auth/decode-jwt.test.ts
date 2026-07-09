import { describe, it, expect } from 'vitest';
import { decodeJwt, signJwt, InvalidTokenError } from './decode-jwt.js';
import { hashPassword, verifyPassword } from './hash-password.js';
import { ApiError, ErrorCode } from '../http/api-error.js';
import { formatResponse, formatError } from '../http/api-response.js';

describe('decodeJwt', () => {
  const secret = 'test-secret-do-not-use-in-prod';
  const validToken = signJwt({ sub: '123e4567-e89b-12d3-a456-426614174000', email: 'test@example.com' }, secret);

  it('decodes a valid token', () => {
    const decoded = decodeJwt(validToken, { secret });
    expect(decoded.sub).toBe('123e4567-e89b-12d3-a456-426614174000');
    expect(decoded.email).toBe('test@example.com');
  });

  it('strips Bearer prefix', () => {
    const decoded = decodeJwt(`Bearer ${validToken}`, { secret });
    expect(decoded.email).toBe('test@example.com');
  });

  it('throws InvalidTokenError on bad signature', () => {
    expect(() => decodeJwt(validToken, { secret: 'wrong-secret' })).toThrow(InvalidTokenError);
  });

  it('throws on empty token', () => {
    expect(() => decodeJwt('', { secret })).toThrow(InvalidTokenError);
  });

  it('throws on invalid uuid in sub', () => {
    const bad = signJwt({ sub: 'not-a-uuid', email: 'test@example.com' }, secret);
    expect(() => decodeJwt(bad, { secret })).toThrow(InvalidTokenError);
  });
});

describe('hashPassword', () => {
  it('hashes and verifies a password', () => {
    const hashed = hashPassword('mySecurePass123');
    expect(hashed).toMatch(/^scrypt\$[0-9a-f]{32}\$[0-9a-f]{128}$/);
    expect(verifyPassword('mySecurePass123', hashed)).toBe(true);
  });

  it('rejects wrong password', () => {
    const hashed = hashPassword('mySecurePass123');
    expect(verifyPassword('wrong', hashed)).toBe(false);
  });

  it('throws on short password', () => {
    expect(() => hashPassword('short')).toThrow();
  });
});

describe('ApiError', () => {
  it('creates badRequest', () => {
    const err = ApiError.badRequest('invalid', { field: 'email' });
    expect(err.statusCode).toBe(400);
    expect(err.code).toBe(ErrorCode.VALIDATION_ERROR);
    expect(err.details).toEqual({ field: 'email' });
  });

  it('creates notFound', () => {
    const err = ApiError.notFound('User');
    expect(err.statusCode).toBe(404);
    expect(err.message).toContain('User');
  });
});

describe('formatResponse', () => {
  it('returns 200 with body', () => {
    const result = formatResponse({ id: '1', name: 'test' }, 200, 'req-123');
    expect(result.statusCode).toBe(200);
    expect(result.headers?.['Content-Type']).toBe('application/json');
    const body = JSON.parse(result.body);
    expect(body.success).toBe(true);
    expect(body.data).toEqual({ id: '1', name: 'test' });
    expect(body.meta.requestId).toBe('req-123');
  });
});

describe('formatError', () => {
  it('formats ApiError', () => {
    const err = ApiError.notFound('User');
    const result = formatError(err, 'req-123');
    expect(result.statusCode).toBe(404);
    const body = JSON.parse(result.body);
    expect(body.success).toBe(false);
    expect(body.error.code).toBe('NOT_FOUND');
  });

  it('formats generic Error as 500', () => {
    const result = formatError(new Error('boom'), 'req-123');
    expect(result.statusCode).toBe(500);
    const body = JSON.parse(result.body);
    expect(body.error.message).toBe('boom');
  });
});
