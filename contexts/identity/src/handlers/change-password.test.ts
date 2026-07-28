import { describe, it, expect, vi, beforeEach } from 'vitest';

const { mockChangePassword, mockBuildContext } = vi.hoisted(() => ({
  mockChangePassword: vi.fn(),
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
import { handler } from './change-password.js';

function makeEvent(body: unknown): APIGatewayProxyEventV2 {
  return {
    version: '2.0',
    routeKey: 'PUT /me/password',
    rawPath: '/me/password',
    rawQueryString: '',
    headers: {},
    requestContext: {
      accountId: '123',
      apiId: 'api',
      domainName: 'api.example.com',
      domainPrefix: 'api',
      http: { method: 'PUT', path: '/me/password', protocol: 'HTTP/1.1', sourceIp: '127.0.0.1', userAgent: 'test' },
      requestId: 'req-1',
      routeKey: 'PUT /me/password',
      stage: '$default',
      time: '01/Jan/2026:00:00:00 +0000',
      timeEpoch: 0,
    } as APIGatewayProxyEventV2['requestContext'],
    body: JSON.stringify(body),
    isBase64Encoded: false,
  } as APIGatewayProxyEventV2;
}

function withAuth(ev: APIGatewayProxyEventV2, userId = 'u-1'): APIGatewayProxyEventV2 {
  return {
    ...ev,
    requestContext: {
      ...ev.requestContext,
      authorizer: { lambda: { userId, email: 'a@b.com', role: 'admin' } },
    },
  } as APIGatewayProxyEventV2;
}

const SELF_ID = 'u-1';

beforeEach(() => {
  mockChangePassword.mockReset();
  mockBuildContext.mockReset();
  mockChangePassword.mockResolvedValue(undefined);
  mockBuildContext.mockResolvedValue({
    logger: { info: vi.fn(), error: vi.fn() },
    userService: { changePassword: mockChangePassword },
  });
});

describe('PUT /me/password handler', () => {
  it('changes password and returns 200 with confirmation', async () => {
    const result = (await (handler as unknown as (e: APIGatewayProxyEventV2) => Promise<{ statusCode: number; body: string }>)(
      withAuth(makeEvent({ newPassword: 'newSecurePass456' })),
    )) as { statusCode: number; body: string };

    expect(result.statusCode).toBe(200);
    const body = JSON.parse(result.body) as { data: { message: string } };
    expect(body.data.message).toBe('password updated');
    expect(mockChangePassword).toHaveBeenCalledWith({
      actorUserId: SELF_ID,
      targetUserId: SELF_ID,
      newPassword: 'newSecurePass456',
    });
  });

  it('rejects too-short password with 400 (zod)', async () => {
    const result = (await (handler as unknown as (e: APIGatewayProxyEventV2) => Promise<{ statusCode: number; body: string }>)(
      withAuth(makeEvent({ newPassword: 'short' })),
    )) as { statusCode: number; body: string };

    expect(result.statusCode).toBe(400);
    expect(mockChangePassword).not.toHaveBeenCalled();
  });

  it('returns 401 when the authorizer context is missing', async () => {
    const result = (await (handler as unknown as (e: APIGatewayProxyEventV2) => Promise<{ statusCode: number; body: string }>)(
      makeEvent({ newPassword: 'newSecurePass456' }),
    )) as { statusCode: number; body: string };

    expect(result.statusCode).toBe(401);
    expect(mockChangePassword).not.toHaveBeenCalled();
  });
});