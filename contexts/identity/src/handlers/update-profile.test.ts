import { describe, it, expect, vi, beforeEach } from 'vitest';

const { mockUpdateUser, mockBuildContext } = vi.hoisted(() => ({
  mockUpdateUser: vi.fn(),
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
import { handler } from './update-profile.js';

function makeEvent(body: unknown, method = 'PATCH'): APIGatewayProxyEventV2 {
  return {
    version: '2.0',
    routeKey: `${method} /me`,
    rawPath: '/me',
    rawQueryString: '',
    headers: {},
    requestContext: {
      accountId: '123',
      apiId: 'api',
      domainName: 'api.example.com',
      domainPrefix: 'api',
      http: { method, path: '/me', protocol: 'HTTP/1.1', sourceIp: '127.0.0.1', userAgent: 'test' },
      requestId: 'req-1',
      routeKey: `${method} /me`,
      stage: '$default',
      time: '01/Jan/2026:00:00:00 +0000',
      timeEpoch: 0,
    } as APIGatewayProxyEventV2['requestContext'],
    body: body === undefined ? undefined : JSON.stringify(body),
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
  mockUpdateUser.mockReset();
  mockBuildContext.mockReset();
  mockBuildContext.mockResolvedValue({
    userService: { updateUser: mockUpdateUser },
  });
});

describe('PATCH /me handler', () => {
  it('updates own profile and returns the public user', async () => {
    const createdAt = new Date('2026-01-01T00:00:00.000Z');
    const updatedAt = new Date('2026-01-02T00:00:00.000Z');
    mockUpdateUser.mockResolvedValue({
      id: SELF_ID,
      email: 'a@b.com',
      fullName: 'New Name',
      passwordHash: 'hashed',
      age: 36,
      role: 'admin',
      active: true,
      createdAt,
      updatedAt,
    });

    const result = (await (handler as unknown as (e: APIGatewayProxyEventV2) => Promise<{ statusCode: number; body: string }>)(
      withAuth(makeEvent({ fullName: 'New Name' })),
    )) as { statusCode: number; body: string };

    expect(result.statusCode).toBe(200);
    const body = JSON.parse(result.body) as {
      data: { id: string; fullName: string; role: string; passwordHash?: string };
    };
    expect(body.data.fullName).toBe('New Name');
    expect(body.data.id).toBe(SELF_ID);
    expect(body.data.passwordHash).toBeUndefined();
    expect(mockUpdateUser).toHaveBeenCalledWith({
      actorUserId: SELF_ID,
      targetUserId: SELF_ID,
      changes: { fullName: 'New Name' },
    });
  });

  it('rejects empty body with 400', async () => {
    const result = (await (handler as unknown as (e: APIGatewayProxyEventV2) => Promise<{ statusCode: number; body: string }>)(
      withAuth(makeEvent({})),
    )) as { statusCode: number; body: string };

    expect(result.statusCode).toBe(400);
    expect(mockUpdateUser).not.toHaveBeenCalled();
  });

  it('rejects too-short fullName with 400 (zod)', async () => {
    const result = (await (handler as unknown as (e: APIGatewayProxyEventV2) => Promise<{ statusCode: number; body: string }>)(
      withAuth(makeEvent({ fullName: 'X' })),
    )) as { statusCode: number; body: string };

    expect(result.statusCode).toBe(400);
    expect(mockUpdateUser).not.toHaveBeenCalled();
  });

  it('returns 401 when the authorizer context is missing', async () => {
    const result = (await (handler as unknown as (e: APIGatewayProxyEventV2) => Promise<{ statusCode: number; body: string }>)(
      makeEvent({ fullName: 'New Name' }),
    )) as { statusCode: number; body: string };

    expect(result.statusCode).toBe(401);
    expect(mockUpdateUser).not.toHaveBeenCalled();
  });
});