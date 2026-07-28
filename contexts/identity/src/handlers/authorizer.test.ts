import { describe, it, expect, vi, beforeEach } from 'vitest';

const { mockLoadJwtSecret, mockVerifyJwt } = vi.hoisted(() => ({
  mockLoadJwtSecret: vi.fn(),
  mockVerifyJwt: vi.fn(),
}));

vi.mock('../../../../shared/src/auth/jwt-secret-loader', () => ({
  loadJwtSecret: mockLoadJwtSecret,
  _resetJwtSecretCache: vi.fn(),
}));

vi.mock('../../../../shared/src/auth/jwt-helpers', () => ({
  verifyJwt: mockVerifyJwt,
  signJwt: vi.fn(),
}));

import type { APIGatewayProxyEventV2 } from 'aws-lambda';
import { handler } from './authorizer.js';

const SECRET = new Uint8Array([1, 2, 3, 4]);

function makeEvent(authHeader: string | undefined): APIGatewayProxyEventV2 {
  return {
    version: '2.0',
    routeKey: 'GET /v1/users/me',
    rawPath: '/v1/users/me',
    rawQueryString: '',
    headers: authHeader === undefined ? {} : { authorization: authHeader },
    requestContext: {
      accountId: '123',
      apiId: 'api',
      domainName: 'api.example.com',
      domainPrefix: 'api',
      http: { method: 'GET', path: '/v1/users/me', protocol: 'HTTP/1.1', sourceIp: '127.0.0.1', userAgent: 'test' },
      requestId: 'req-1',
      routeKey: 'GET /v1/users/me',
      stage: '$default',
      time: '01/Jan/2026:00:00:00 +0000',
      timeEpoch: 0,
    } as APIGatewayProxyEventV2['requestContext'],
    body: undefined,
    isBase64Encoded: false,
  } as APIGatewayProxyEventV2;
}

beforeEach(() => {
  mockLoadJwtSecret.mockReset();
  mockVerifyJwt.mockReset();
  mockLoadJwtSecret.mockResolvedValue(SECRET);
});

describe('HttpApi Authorizer handler', () => {
  it('authorizes a valid Bearer token and returns userId/email/role in context', async () => {
    mockVerifyJwt.mockResolvedValue({
      sub: 'user-1',
      email: 'u@example.com',
      role: 'admin',
    });

    const result = await handler(makeEvent('Bearer valid-token'));

    expect(result.isAuthorized).toBe(true);
    expect(result.context).toEqual({
      userId: 'user-1',
      email: 'u@example.com',
      role: 'admin',
    });
    expect(mockVerifyJwt).toHaveBeenCalledWith('valid-token', SECRET);
  });

  it('denies when Authorization header is missing', async () => {
    const result = await handler(makeEvent(undefined));

    expect(result.isAuthorized).toBe(false);
    expect(result.context).toBeUndefined();
    expect(mockLoadJwtSecret).not.toHaveBeenCalled();
  });

  it('denies when Authorization header is not Bearer', async () => {
    const result = await handler(makeEvent('Basic abc123'));

    expect(result.isAuthorized).toBe(false);
    expect(mockLoadJwtSecret).not.toHaveBeenCalled();
  });

  it('denies when JWT verify throws', async () => {
    mockVerifyJwt.mockRejectedValue(new Error('signature mismatch'));

    const result = await handler(makeEvent('Bearer bad-token'));

    expect(result.isAuthorized).toBe(false);
    expect(result.context).toBeUndefined();
  });

  it('denies when JWT has no sub claim', async () => {
    mockVerifyJwt.mockResolvedValue({
      email: 'u@example.com',
      role: 'admin',
    });

    const result = await handler(makeEvent('Bearer token-no-sub'));

    expect(result.isAuthorized).toBe(false);
    expect(result.context).toBeUndefined();
  });

  it('handles uppercase Authorization header', async () => {
    mockVerifyJwt.mockResolvedValue({
      sub: 'user-2',
      email: '',
      role: '',
    });
    const ev = makeEvent(undefined);
    ev.headers = { Authorization: 'Bearer token-2' };

    const result = await handler(ev);

    expect(result.isAuthorized).toBe(true);
    expect(result.context?.userId).toBe('user-2');
  });

  it('defaults email and role to empty string when claims lack string values', async () => {
    mockVerifyJwt.mockResolvedValue({
      sub: 'user-3',
      email: 42 as unknown as string,
      role: null as unknown as string,
    });

    const result = await handler(makeEvent('Bearer token-no-email-role'));

    expect(result.isAuthorized).toBe(true);
    expect(result.context).toEqual({
      userId: 'user-3',
      email: '',
      role: '',
    });
  });

  it('denies when event.headers is undefined', async () => {
    const ev = makeEvent(undefined);
    (ev as unknown as { headers: undefined }).headers = undefined;

    const result = await handler(ev);

    expect(result.isAuthorized).toBe(false);
    expect(mockLoadJwtSecret).not.toHaveBeenCalled();
  });
});