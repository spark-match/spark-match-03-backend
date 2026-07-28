import { describe, it, expect, vi, beforeEach } from 'vitest';

const { mockActivateUser, mockBuildContext } = vi.hoisted(() => ({
  mockActivateUser: vi.fn(),
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
import { handler } from './activate-user.js';

const ADMIN_ID = 'admin-1';
const TARGET_ID = '33333333-3333-3333-3333-333333333333';

function makeEvent(pathParameters: Record<string, string | undefined> | null): APIGatewayProxyEventV2 {
  return {
    version: '2.0',
    routeKey: 'POST /users/{userId}/activate',
    rawPath: `/users/${TARGET_ID}/activate`,
    rawQueryString: '',
    headers: {},
    pathParameters,
    requestContext: {
      accountId: '123',
      apiId: 'api',
      domainName: 'api.example.com',
      domainPrefix: 'api',
      http: { method: 'POST', path: `/users/${TARGET_ID}/activate`, protocol: 'HTTP/1.1', sourceIp: '127.0.0.1', userAgent: 'test' },
      requestId: 'req-1',
      routeKey: 'POST /users/{userId}/activate',
      stage: '$default',
      time: '01/Jan/2026:00:00:00 +0000',
      timeEpoch: 0,
    } as APIGatewayProxyEventV2['requestContext'],
    body: undefined,
    isBase64Encoded: false,
  } as APIGatewayProxyEventV2;
}

function withAuth(ev: APIGatewayProxyEventV2, userId = ADMIN_ID): APIGatewayProxyEventV2 {
  return {
    ...ev,
    requestContext: {
      ...ev.requestContext,
      authorizer: { lambda: { userId, email: 'admin@b.com', role: 'admin' } },
    },
  } as APIGatewayProxyEventV2;
}

beforeEach(() => {
  mockActivateUser.mockReset();
  mockBuildContext.mockReset();
  mockBuildContext.mockResolvedValue({
    userService: { activateUser: mockActivateUser },
  });
});

describe('POST /users/{userId}/activate handler', () => {
  it('activates the user and returns the public user', async () => {
    const createdAt = new Date('2026-01-01T00:00:00.000Z');
    const updatedAt = new Date('2026-01-02T00:00:00.000Z');
    mockActivateUser.mockResolvedValue({
      id: TARGET_ID,
      email: 'a@b.com',
      fullName: 'Ada',
      passwordHash: 'hashed',
      age: null,
      role: 'admin',
      active: true,
      createdAt,
      updatedAt,
    });

    const result = (await (handler as unknown as (e: APIGatewayProxyEventV2) => Promise<{ statusCode: number; body: string }>)(
      withAuth(makeEvent({ userId: TARGET_ID })),
    )) as { statusCode: number; body: string };

    expect(result.statusCode).toBe(200);
    const body = JSON.parse(result.body) as {
      data: { id: string; active: boolean; passwordHash?: string };
    };
    expect(body.data.id).toBe(TARGET_ID);
    expect(body.data.active).toBe(true);
    expect(body.data.passwordHash).toBeUndefined();
    expect(mockActivateUser).toHaveBeenCalledWith({
      actorUserId: ADMIN_ID,
      targetUserId: TARGET_ID,
    });
  });

  it('rejects missing userId with 400', async () => {
    const result = (await (handler as unknown as (e: APIGatewayProxyEventV2) => Promise<{ statusCode: number; body: string }>)(
      withAuth(makeEvent(null)),
    )) as { statusCode: number; body: string };

    expect(result.statusCode).toBe(400);
    expect(mockActivateUser).not.toHaveBeenCalled();
  });

  it('returns 401 when the authorizer context is missing', async () => {
    const result = (await (handler as unknown as (e: APIGatewayProxyEventV2) => Promise<{ statusCode: number; body: string }>)(
      makeEvent({ userId: TARGET_ID }),
    )) as { statusCode: number; body: string };

    expect(result.statusCode).toBe(401);
    expect(mockActivateUser).not.toHaveBeenCalled();
  });
});