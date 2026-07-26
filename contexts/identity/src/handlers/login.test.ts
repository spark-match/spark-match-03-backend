import { describe, it, expect, vi, beforeEach } from 'vitest';

const { mockAuthenticate, mockSignForUser, mockBuildContext } = vi.hoisted(() => ({
  mockAuthenticate: vi.fn(),
  mockSignForUser: vi.fn(),
  mockBuildContext: vi.fn(),
}));

vi.mock('../composition.js', () => ({
  buildContext: mockBuildContext,
}));

vi.mock('@aws-lambda-powertools/tracer', () => ({
  Tracer: class {
    isTracingEnabled() {
      return false;
    }
    getSegment() {
      return { addNewSubsegment: () => ({ close: () => {} }) };
    }
    captureAsyncFunc() {}
  },
}));

import type { APIGatewayProxyEventV2 } from 'aws-lambda';
import { handler } from './login.js';

function makeEvent(body: unknown): APIGatewayProxyEventV2 {
  return {
    version: '2.0',
    routeKey: 'POST /login',
    rawPath: '/login',
    rawQueryString: '',
    headers: {},
    requestContext: {
      accountId: '123',
      apiId: 'api',
      domainName: 'api.example.com',
      domainPrefix: 'api',
      http: { method: 'POST', path: '/login', protocol: 'HTTP/1.1', sourceIp: '127.0.0.1', userAgent: 'test' },
      requestId: 'req-1',
      routeKey: 'POST /login',
      stage: '$default',
      time: '01/Jan/2026:00:00:00 +0000',
      timeEpoch: 0,
    } as APIGatewayProxyEventV2['requestContext'],
    body: typeof body === 'string' ? body : JSON.stringify(body),
    isBase64Encoded: false,
  } as APIGatewayProxyEventV2;
}

const FAKE_JWT = 'eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiJ1LTEifQ.signature';

beforeEach(() => {
  mockAuthenticate.mockReset();
  mockSignForUser.mockReset();
  mockBuildContext.mockReset();
  mockSignForUser.mockResolvedValue(FAKE_JWT);
  mockBuildContext.mockResolvedValue({
    logger: { info: vi.fn(), error: vi.fn() },
    userService: { authenticate: mockAuthenticate },
    defaultTokenExpiresSeconds: 86400,
    signForUser: mockSignForUser,
  });
});

describe('POST /login handler', () => {
  it('returns access token and user on successful authentication', async () => {
    mockAuthenticate.mockResolvedValue({
      id: '3a8e6c4e-1f3a-4f0e-9a3d-1c2b3a4d5e6f',
      email: 'a@b.com',
      fullName: 'Ada',
      passwordHash: 'hashed',
      age: null,
      role: 'admin',
      active: true,
      createdAt: new Date(),
      updatedAt: new Date(),
    });

    const result = (await (handler as unknown as (e: APIGatewayProxyEventV2) => Promise<{ statusCode: number; body: string }>)(
      makeEvent({ email: 'a@b.com', password: 'supersecret123' }),
    )) as { statusCode: number; body: string };

    expect(result.statusCode).toBe(200);
    const body = JSON.parse(result.body) as {
      data: { accessToken: string; expiresIn: number; user: { id: string; email: string; fullName: string } };
    };
    expect(body.data.accessToken).toBe(FAKE_JWT);
    expect(body.data.expiresIn).toBe(86400);
    expect(body.data.user).toEqual({
      id: '3a8e6c4e-1f3a-4f0e-9a3d-1c2b3a4d5e6f',
      email: 'a@b.com',
      fullName: 'Ada',
    });
    expect(mockSignForUser).toHaveBeenCalledWith(
      expect.objectContaining({ id: '3a8e6c4e-1f3a-4f0e-9a3d-1c2b3a4d5e6f', email: 'a@b.com' }),
    );
  });

  it('rejects invalid input with 400', async () => {
    const result = (await (handler as unknown as (e: APIGatewayProxyEventV2) => Promise<{ statusCode: number; body: string }>)(
      makeEvent({ email: 'not-an-email', password: 'short' }),
    )) as { statusCode: number; body: string };

    expect(result.statusCode).toBe(400);
    expect(mockAuthenticate).not.toHaveBeenCalled();
    expect(mockSignForUser).not.toHaveBeenCalled();
  });
});