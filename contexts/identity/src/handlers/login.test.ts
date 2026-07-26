import { describe, it, expect, vi, beforeEach } from 'vitest';

const { mockAuthenticate, mockBuildContext, mockSend } = vi.hoisted(() => ({
  mockAuthenticate: vi.fn(),
  mockBuildContext: vi.fn(),
  mockSend: vi.fn(),
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

vi.mock('@aws-sdk/client-secrets-manager', () => ({
  SecretsManagerClient: vi.fn().mockImplementation(() => ({ send: mockSend })),
  GetSecretValueCommand: vi.fn().mockImplementation((input: { SecretId: string }) => ({ input })),
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

beforeEach(() => {
  mockAuthenticate.mockReset();
  mockBuildContext.mockReset();
  mockSend.mockReset();
  process.env.JWT_SECRET_ARN = 'arn:aws:secretsmanager:us-east-1:123:secret:jwt';
  mockBuildContext.mockResolvedValue({
    logger: { info: vi.fn(), error: vi.fn() },
    userService: { authenticate: mockAuthenticate },
  });
  // 32-byte secret: HS256 requires at least 32 bytes
  mockSend.mockResolvedValue({ SecretString: 'a'.repeat(32) });
});

describe('POST /login handler', () => {
  it('returns access token and user on successful authentication', async () => {
    mockAuthenticate.mockResolvedValue({
      id: '3a8e6c4e-1f3a-4f0e-9a3d-1c2b3a4d5e6f',
      email: 'a@b.com',
      fullName: 'Ada',
    });

    const result = (await (handler as unknown as (e: APIGatewayProxyEventV2) => Promise<{ statusCode: number; body: string }>)(
      makeEvent({ email: 'a@b.com', password: 'supersecret123' }),
    )) as { statusCode: number; body: string };

    expect(result.statusCode).toBe(200);
    const body = JSON.parse(result.body) as {
      data: { accessToken: string; expiresIn: number; user: { id: string; email: string; fullName: string } };
    };
    expect(body.data.accessToken).toMatch(/^[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$/);
    expect(body.data.expiresIn).toBe(86400);
    expect(body.data.user).toEqual({
      id: '3a8e6c4e-1f3a-4f0e-9a3d-1c2b3a4d5e6f',
      email: 'a@b.com',
      fullName: 'Ada',
    });
  });

  it('rejects invalid input with 400', async () => {
    const result = (await (handler as unknown as (e: APIGatewayProxyEventV2) => Promise<{ statusCode: number; body: string }>)(
      makeEvent({ email: 'not-an-email', password: 'short' }),
    )) as { statusCode: number; body: string };

    expect(result.statusCode).toBe(400);
    expect(mockAuthenticate).not.toHaveBeenCalled();
  });

  it('returns 500 when JWT_SECRET_ARN env is not set', async () => {
    delete process.env.JWT_SECRET_ARN;
    mockAuthenticate.mockResolvedValue({
      id: '3a8e6c4e-1f3a-4f0e-9a3d-1c2b3a4d5e6f',
      email: 'a@b.com',
      fullName: 'Ada',
    });

    const result = (await (handler as unknown as (e: APIGatewayProxyEventV2) => Promise<{ statusCode: number; body: string }>)(
      makeEvent({ email: 'a@b.com', password: 'supersecret123' }),
    )) as { statusCode: number; body: string };

    expect(result.statusCode).toBe(500);
  });
});
