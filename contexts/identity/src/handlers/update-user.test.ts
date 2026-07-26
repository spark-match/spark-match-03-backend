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
import { handler } from './update-user.js';

const ADMIN_ID = 'admin-1';
const TARGET_ID = '33333333-3333-3333-3333-333333333333';

function makeEvent(
  pathParameters: Record<string, string | undefined> | null,
  body: unknown,
): APIGatewayProxyEventV2 {
  return {
    version: '2.0',
    routeKey: 'PATCH /users/{userId}',
    rawPath: `/users/${TARGET_ID}`,
    rawQueryString: '',
    headers: {},
    pathParameters,
    requestContext: {
      accountId: '123',
      apiId: 'api',
      domainName: 'api.example.com',
      domainPrefix: 'api',
      http: { method: 'PATCH', path: `/users/${TARGET_ID}`, protocol: 'HTTP/1.1', sourceIp: '127.0.0.1', userAgent: 'test' },
      requestId: 'req-1',
      routeKey: 'PATCH /users/{userId}',
      stage: '$default',
      time: '01/Jan/2026:00:00:00 +0000',
      timeEpoch: 0,
    } as APIGatewayProxyEventV2['requestContext'],
    body: body === undefined ? undefined : JSON.stringify(body),
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
  mockUpdateUser.mockReset();
  mockBuildContext.mockReset();
  mockBuildContext.mockResolvedValue({
    userService: { updateUser: mockUpdateUser },
  });
});

describe('PATCH /users/{userId} handler', () => {
  it('updates the target user as admin and returns the public user', async () => {
    const createdAt = new Date('2026-01-01T00:00:00.000Z');
    const updatedAt = new Date('2026-01-02T00:00:00.000Z');
    mockUpdateUser.mockResolvedValue({
      id: TARGET_ID,
      email: 'a@b.com',
      fullName: 'Renamed',
      passwordHash: 'hashed',
      age: 40,
      role: 'admin',
      active: true,
      createdAt,
      updatedAt,
    });

    const result = (await (handler as unknown as (e: APIGatewayProxyEventV2) => Promise<{ statusCode: number; body: string }>)(
      withAuth(makeEvent({ userId: TARGET_ID }, { fullName: 'Renamed', age: 40 })),
    )) as { statusCode: number; body: string };

    expect(result.statusCode).toBe(200);
    const body = JSON.parse(result.body) as {
      data: { id: string; fullName: string; age: number; passwordHash?: string };
    };
    expect(body.data.id).toBe(TARGET_ID);
    expect(body.data.fullName).toBe('Renamed');
    expect(body.data.age).toBe(40);
    expect(body.data.passwordHash).toBeUndefined();
    expect(mockUpdateUser).toHaveBeenCalledWith({
      actorUserId: ADMIN_ID,
      targetUserId: TARGET_ID,
      changes: { fullName: 'Renamed', age: 40 },
    });
  });

  it('allows admin to update a different user (RBAC)', async () => {
    mockUpdateUser.mockResolvedValue({
      id: TARGET_ID,
      email: 'a@b.com',
      fullName: 'Only Name',
      passwordHash: 'hashed',
      age: null,
      role: 'admin',
      active: true,
      createdAt: new Date(),
      updatedAt: new Date(),
    });

    const result = (await (handler as unknown as (e: APIGatewayProxyEventV2) => Promise<{ statusCode: number; body: string }>)(
      withAuth(makeEvent({ userId: TARGET_ID }, { fullName: 'Only Name' })),
    )) as { statusCode: number; body: string };

    expect(result.statusCode).toBe(200);
    expect(mockUpdateUser).toHaveBeenCalledWith({
      actorUserId: ADMIN_ID,
      targetUserId: TARGET_ID,
      changes: { fullName: 'Only Name' },
    });
  });

  it('rejects missing userId path parameter with 400', async () => {
    const result = (await (handler as unknown as (e: APIGatewayProxyEventV2) => Promise<{ statusCode: number; body: string }>)(
      withAuth(makeEvent(null, { fullName: 'X' })),
    )) as { statusCode: number; body: string };

    expect(result.statusCode).toBe(400);
    expect(mockUpdateUser).not.toHaveBeenCalled();
  });

  it('rejects empty body with 400', async () => {
    const result = (await (handler as unknown as (e: APIGatewayProxyEventV2) => Promise<{ statusCode: number; body: string }>)(
      withAuth(makeEvent({ userId: TARGET_ID }, {})),
    )) as { statusCode: number; body: string };

    expect(result.statusCode).toBe(400);
    expect(mockUpdateUser).not.toHaveBeenCalled();
  });

  it('rejects too-short fullName with 400 (zod)', async () => {
    const result = (await (handler as unknown as (e: APIGatewayProxyEventV2) => Promise<{ statusCode: number; body: string }>)(
      withAuth(makeEvent({ userId: TARGET_ID }, { fullName: 'X' })),
    )) as { statusCode: number; body: string };

    expect(result.statusCode).toBe(400);
    expect(mockUpdateUser).not.toHaveBeenCalled();
  });
});