import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { Logger } from '@aws-lambda-powertools/logger';

const mockSsmGetRequiredString = vi.fn();
const mockSecretsGetRequiredString = vi.fn();
const mockVerifyJwt = vi.fn();

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

vi.mock('../auth/jwt-helpers.js', () => ({
  verifyJwt: (...args: unknown[]) => mockVerifyJwt(...args),
  signJwt: vi.fn(),
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
  mockVerifyJwt.mockReset();
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

  it('defaults email and role to empty string when ctx has non-string values', async () => {
    const { requireAuth: freshRequireAuth } = await import('./require-auth.js');
    const event = {
      requestContext: {
        authorizer: {
          lambda: {
            userId: 'u-1',
            email: 42 as unknown as string,
            role: null as unknown as string,
          },
        },
      },
    };
    const auth = await freshRequireAuth(event, SILENT_LOGGER);
    expect(auth.userId).toBe('u-1');
    expect(auth.email).toBe('');
    expect(auth.role).toBe('');
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

  it('throws unauthorized on JWT verification failure (non-ApiError thrown by verifyJwt)', async () => {
    mockSsmGetRequiredString.mockResolvedValue('arn:jwt');
    mockSecretsGetRequiredString.mockResolvedValue(SECRET_VALUE);
    mockVerifyJwt.mockRejectedValue(new Error('signature mismatch'));
    const { requireAuth: freshRequireAuth } = await import('./require-auth.js');

    const event = { headers: { authorization: `Bearer any-token` } };
    await expect(freshRequireAuth(event, SILENT_LOGGER)).rejects.toMatchObject({
      statusCode: 401,
      code: 'unauthorized',
    });
  });
it('returns AuthContext from a valid Bearer JWT', async () => {
    mockSsmGetRequiredString.mockResolvedValue('arn:jwt');
    mockSecretsGetRequiredString.mockResolvedValue(SECRET_VALUE);
    mockVerifyJwt.mockResolvedValue({
      sub: 'u-1',
      email: 'a@b.com',
      role: 'admin',
    });
    const { requireAuth: freshRequireAuth } = await import('./require-auth.js');

    const event = { headers: { authorization: `Bearer token` } };

    const auth = await freshRequireAuth(event, SILENT_LOGGER);
    expect(auth.userId).toBe('u-1');
    expect(auth.email).toBe('a@b.com');
    expect(auth.role).toBe('admin');
  });

  it('throws unauthorized when JWT verify returns claims without a sub (fallback path)', async () => {
    mockSsmGetRequiredString.mockResolvedValue('arn:jwt');
    mockSecretsGetRequiredString.mockResolvedValue(SECRET_VALUE);
    mockVerifyJwt.mockResolvedValue({ email: 'a@b.com', role: 'admin' } as never);
    const { requireAuth: freshRequireAuth } = await import('./require-auth.js');

    const event = { headers: { authorization: `Bearer any-token` } };
    await expect(freshRequireAuth(event, SILENT_LOGGER)).rejects.toMatchObject({
      statusCode: 401,
      code: 'unauthorized',
    });
  });

  it('re-throws an ApiError thrown by verifyJwt (fallback path)', async () => {
    mockSsmGetRequiredString.mockResolvedValue('arn:jwt');
    mockSecretsGetRequiredString.mockResolvedValue(SECRET_VALUE);
    const propagated = (await import('../http/api-error.js')).ApiError.unauthorized('inner-api-error');
    mockVerifyJwt.mockRejectedValue(propagated);
    const { requireAuth: freshRequireAuth } = await import('./require-auth.js');

    const event = { headers: { authorization: `Bearer any-token` } };
    await expect(freshRequireAuth(event, SILENT_LOGGER)).rejects.toBe(propagated);
  });
});
