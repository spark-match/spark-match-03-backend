import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { Logger } from '@aws-lambda-powertools/logger';

const mockSsmGetRequiredString = vi.fn();
const mockSecretsGetRequiredString = vi.fn();

vi.mock('../infra/ssm-reader.js', () => ({
  createSsmReader: () => ({
    getString: mockSsmGetRequiredString,
    getRequiredString: mockSsmGetRequiredString,
    invalidate: vi.fn(),
  }),
}));

vi.mock('../infra/secrets-reader.js', () => ({
  createSecretsReader: () => ({
    getString: mockSecretsGetRequiredString,
    getRequiredString: mockSecretsGetRequiredString,
    getJson: mockSecretsGetRequiredString,
    clearCache: vi.fn(),
  }),
}));

const SILENT_LOGGER = {
  info: vi.fn(),
  warn: vi.fn(),
  error: vi.fn(),
  debug: vi.fn(),
  appendKeys: vi.fn(),
} as unknown as Logger;

const SECRET_VALUE = 'a'.repeat(64);

beforeEach(() => {
  mockSsmGetRequiredString.mockReset();
  mockSecretsGetRequiredString.mockReset();
  vi.resetModules();
});

describe('requireAuth (authorizer context path)', () => {
  it('returns AuthContext built from a valid Lambda authorizer context', async () => {
    const { requireAuth: freshRequireAuth } = await import('./require-auth.js');
    const event = {
      requestContext: {
        authorizer: {
          lambda: {
            userId: 'u-1',
            email: 'a@b.com',
            role: 'admin',
          },
        },
      },
    };
    const auth = await freshRequireAuth(event, SILENT_LOGGER);
    expect(auth.userId).toBe('u-1');
    expect(auth.email).toBe('a@b.com');
    expect(auth.role).toBe('admin');
    expect(mockSsmGetRequiredString).not.toHaveBeenCalled();
  });
});

describe('requireAuth (fallback path)', () => {
  it('throws unauthorized with synthetic detail when no Bearer header and no context', async () => {
    const { requireAuth: freshRequireAuth } = await import('./require-auth.js');
    const event = { headers: {}, requestContext: { path: '/v1/x' } };
    await expect(freshRequireAuth(event, SILENT_LOGGER)).rejects.toMatchObject({
      statusCode: 401,
      code: 'unauthorized',
    });
  });

  it('throws unauthorized on JWT verification failure', async () => {
    mockSsmGetRequiredString.mockResolvedValue('arn:jwt');
    mockSecretsGetRequiredString.mockResolvedValue(SECRET_VALUE);
    const { signJwt } = await import('./jwt-helpers.js');
    const { requireAuth: freshRequireAuth } = await import('./require-auth.js');

    const badToken = await signJwt(
      new TextEncoder().encode('different-secret-also-64-chars-long-aaaaaaaaaaaaaaaaaaaa'),
      { subject: 'u-1', email: 'a@b.com', role: 'admin' },
    );
    const event = { headers: { authorization: `Bearer ${badToken}` } };
    await expect(freshRequireAuth(event, SILENT_LOGGER)).rejects.toMatchObject({
      statusCode: 401,
      code: 'unauthorized',
    });
  });

  it('returns AuthContext from a valid Bearer JWT', async () => {
    mockSsmGetRequiredString.mockResolvedValue('arn:jwt');
    mockSecretsGetRequiredString.mockResolvedValue(SECRET_VALUE);
    const { signJwt } = await import('./jwt-helpers.js');
    const { requireAuth: freshRequireAuth } = await import('./require-auth.js');

    const token = await signJwt(new TextEncoder().encode(SECRET_VALUE), {
      subject: 'u-1',
      email: 'a@b.com',
      role: 'admin',
    });
    const event = { headers: { authorization: `Bearer ${token}` } };
    const auth = await freshRequireAuth(event, SILENT_LOGGER);
    expect(auth.userId).toBe('u-1');
    expect(auth.email).toBe('a@b.com');
    expect(auth.role).toBe('admin');
  });
});
