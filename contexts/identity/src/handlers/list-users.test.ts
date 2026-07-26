import { describe, it, expect, vi, beforeEach } from 'vitest';

const { mockListUsers, mockBuildContext } = vi.hoisted(() => ({
  mockListUsers: vi.fn(),
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
import { handler } from './list-users.js';

function makeEvent(queryStringParameters: Record<string, string | undefined> | null): APIGatewayProxyEventV2 {
  return {
    version: '2.0',
    routeKey: 'GET /users',
    rawPath: '/users',
    rawQueryString: '',
    headers: {},
    queryStringParameters,
    requestContext: {
      accountId: '123',
      apiId: 'api',
      domainName: 'api.example.com',
      domainPrefix: 'api',
      http: { method: 'GET', path: '/users', protocol: 'HTTP/1.1', sourceIp: '127.0.0.1', userAgent: 'test' },
      requestId: 'req-1',
      routeKey: 'GET /users',
      stage: '$default',
      time: '01/Jan/2026:00:00:00 +0000',
      timeEpoch: 0,
    } as APIGatewayProxyEventV2['requestContext'],
    body: undefined,
    isBase64Encoded: false,
  } as APIGatewayProxyEventV2;
}

function withAuth(ev: APIGatewayProxyEventV2, userId = 'admin-1'): APIGatewayProxyEventV2 {
  return {
    ...ev,
    requestContext: {
      ...ev.requestContext,
      authorizer: { lambda: { userId, email: 'admin@b.com', role: 'admin' } },
    },
  } as APIGatewayProxyEventV2;
}

const ADMIN_ID = 'admin-1';
const SELF_ID = 'u-1';

beforeEach(() => {
  mockListUsers.mockReset();
  mockBuildContext.mockReset();
  mockBuildContext.mockResolvedValue({
    userService: { listUsers: mockListUsers },
  });
});

describe('GET /users handler', () => {
  it('lists users with default limit when no query params', async () => {
    const createdAt = new Date('2026-01-01T00:00:00.000Z');
    const updatedAt = new Date('2026-01-01T00:00:00.000Z');
    mockListUsers.mockResolvedValue({
      users: [
        {
          id: SELF_ID,
          email: 'a@b.com',
          fullName: 'Ada',
          passwordHash: 'h',
          age: null,
          role: 'admin',
          active: true,
          createdAt,
          updatedAt,
        },
      ],
      nextCursor: null,
    });

    const result = (await (handler as unknown as (e: APIGatewayProxyEventV2) => Promise<{ statusCode: number; body: string }>)(
      withAuth(makeEvent(null)),
    )) as { statusCode: number; body: string };

    expect(result.statusCode).toBe(200);
    expect(mockListUsers).toHaveBeenCalledWith({
      actorUserId: ADMIN_ID,
      filters: { limit: 20 },
    });
    const body = JSON.parse(result.body) as {
      data: { users: Array<{ id: string; passwordHash?: string }>; nextCursor: string | null };
    };
    expect(body.data.users).toHaveLength(1);
    expect(body.data.users[0]?.passwordHash).toBeUndefined();
    expect(body.data.nextCursor).toBeNull();
  });

  it('parses query params (limit, cursor, active, role)', async () => {
    mockListUsers.mockResolvedValue({ users: [], nextCursor: null });

    await (handler as unknown as (e: APIGatewayProxyEventV2) => Promise<{ statusCode: number; body: string }>)(
      withAuth(makeEvent({ limit: '50', cursor: 'abc', active: 'false', role: 'admin' })),
    );

    expect(mockListUsers).toHaveBeenCalledWith({
      actorUserId: ADMIN_ID,
      filters: { limit: 50, cursor: 'abc', active: false, role: 'admin' },
    });
  });

  it('rejects invalid limit (non-numeric) with 400', async () => {
    const result = (await (handler as unknown as (e: APIGatewayProxyEventV2) => Promise<{ statusCode: number; body: string }>)(
      withAuth(makeEvent({ limit: 'abc' })),
    )) as { statusCode: number; body: string };

    expect(result.statusCode).toBe(400);
  });

  it('rejects out-of-range limit (>100) with 400', async () => {
    const result = (await (handler as unknown as (e: APIGatewayProxyEventV2) => Promise<{ statusCode: number; body: string }>)(
      withAuth(makeEvent({ limit: '500' })),
    )) as { statusCode: number; body: string };

    expect(result.statusCode).toBe(400);
  });

  it('rejects invalid role with 400', async () => {
    const result = (await (handler as unknown as (e: APIGatewayProxyEventV2) => Promise<{ statusCode: number; body: string }>)(
      withAuth(makeEvent({ role: 'superuser' })),
    )) as { statusCode: number; body: string };

    expect(result.statusCode).toBe(400);
  });

  it('accepts active=all to disable filter', async () => {
    mockListUsers.mockResolvedValue({ users: [], nextCursor: null });

    await (handler as unknown as (e: APIGatewayProxyEventV2) => Promise<{ statusCode: number; body: string }>)(
      withAuth(makeEvent({ active: 'all' })),
    );

    expect(mockListUsers).toHaveBeenCalledWith({
      actorUserId: ADMIN_ID,
      filters: { limit: 20, active: null },
    });
  });
});