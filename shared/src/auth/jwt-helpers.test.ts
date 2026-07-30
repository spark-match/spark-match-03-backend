import { describe, it, expect } from 'vitest';
import { signJwt, verifyJwt, DEFAULT_JWT_EXPIRES_SECONDS } from './jwt-helpers.js';
import { ApiError } from '../http/api-error.js';

const SECRET = new TextEncoder().encode('a'.repeat(32)); // 32-byte HS256 secret

describe('signJwt', () => {
  it('produces a valid JWT with subject, email, role, and iss/aud', async () => {
    const token = await signJwt(SECRET, {
      subject: 'u-123',
      email: 'a@b.com',
      role: 'admin',
    });
    expect(token).toMatch(/^[\w-]+\.[\w-]+\.[\w-]+$/);
  });

  it('throws if secret is too short', async () => {
    const shortSecret = new TextEncoder().encode('too-short');
    await expect(
      signJwt(shortSecret, { subject: 'u-1', email: 'a@b.com', role: 'admin' }),
    ).rejects.toThrow(/32 bytes/);
  });

  it('honors custom expiresInSeconds', async () => {
    const token = await signJwt(SECRET, {
      subject: 'u-1',
      email: 'a@b.com',
      role: 'admin',
      expiresInSeconds: 60,
    });
    const claims = await verifyJwt(token, SECRET);
    expect(claims.exp! - claims.iat!).toBe(60);
  });

  it('defaults to DEFAULT_JWT_EXPIRES_SECONDS (24h) when expiresInSeconds is omitted', async () => {
    expect(DEFAULT_JWT_EXPIRES_SECONDS).toBe(86400);
    const token = await signJwt(SECRET, {
      subject: 'u-1',
      email: 'a@b.com',
      role: 'admin',
    });
    const claims = await verifyJwt(token, SECRET);
    expect(claims.exp! - claims.iat!).toBe(86400);
  });
});

describe('verifyJwt', () => {
  it('returns claims on valid token', async () => {
    const token = await signJwt(SECRET, {
      subject: 'u-abc',
      email: 'x@y.com',
      role: 'admin',
    });
    const claims = await verifyJwt(token, SECRET);
    expect(claims.sub).toBe('u-abc');
    expect(claims.email).toBe('x@y.com');
    expect(claims.role).toBe('admin');
    expect(claims.iss).toBe('spark-match-backend');
    expect(claims.aud).toBe('spark-match-api');
  });

  it('throws ApiError.unauthorized on tampered token', async () => {
    const token = await signJwt(SECRET, { subject: 'u-1', email: 'a@b.com', role: 'admin' });
    const tampered = token.slice(0, -2) + 'xx';
    await expect(verifyJwt(tampered, SECRET)).rejects.toThrow(ApiError);
  });

  it('throws ApiError.unauthorized on wrong secret', async () => {
    const token = await signJwt(SECRET, { subject: 'u-1', email: 'a@b.com', role: 'admin' });
    const wrongSecret = new TextEncoder().encode('b'.repeat(32));
    await expect(verifyJwt(token, wrongSecret)).rejects.toThrow(ApiError);
  });

  it('throws ApiError.unauthorized on expired token', async () => {
    const token = await signJwt(SECRET, {
      subject: 'u-1',
      email: 'a@b.com',
      role: 'admin',
      expiresInSeconds: 1,
    });
    // Wait for the token to expire
    await new Promise((resolve) => setTimeout(resolve, 1100));
    await expect(verifyJwt(token, SECRET)).rejects.toThrow(ApiError);
  });
});
