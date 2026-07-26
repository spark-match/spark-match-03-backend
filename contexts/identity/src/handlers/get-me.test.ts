import { describe, it, expect, vi, beforeEach } from 'vitest';

const { mockGetUser, mockBuildContext } = vi.hoisted(() => ({
  mockGetUser: vi.fn(),
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
import { handler } from './get-me.js';

function makeEvent(overrides: Partial<APIGatewayProxyEventV2> = {}): APIGatewayProxyEventV2 {
  return {
    version: '2.0',
    routeKey: 'GET /me',
    rawPath: '/me',
    rawQueryString: '',
    headers: {},
    requestContext: {
      accountId: '123',
      apiId: 'api',
      domainName: 'api.example.com',
      domainPrefix: 'api',
      http: { method: 'GET', path: '/me', protocol: 'HTTP/1.1', sourceIp: '127.0.0.1', userAgent: 'test' },
      requestId: 'req-1',
      routeKey: 'GET /me',
      stage: '$default',
      time: '01/Jan/2026:00:00:00 +0000',
      timeEpoch: 0,
    } as APIGatewayProxyEventV2['requestContext'],
    body: undefined,
    isBase64Encoded: false,
    ...overrides,
  } as APIGatewayProxyEventV2;
}

function makeAuthEvent(userId = 'u-1'): APIGatewayProxyEventV2 {
  return makeEvent({
    requestContext: {
      ...makeEvent().requestContext,
      authorizer: {
        lambda: { userId, email: 'a@b.com', role: 'admin' },
      },
    } as APIGatewayProxyEventV2['requestContext'],
  });
}

const SELF_ID = 'u-1';

beforeEach(() => {
  mockGetUser.mockReset();
  mockBuildContext.mockReset();
  mockBuildContext.mockResolvedValue({
    userService: { getUser: mockGetUser },
  });
});

describe('GET /me handler - happy path', () => {
  it('returns the user profile when found', async () => {
    const createdAt = new Date('2026-01-01T00:00:00.000Z');
    const updatedAt = new Date('2026-01-02T00:00:00.000Z');
    mockGetUser.mockResolvedValue({
      id: SELF_ID,
      email: 'a@b.com',
      fullName: 'Ada',
      passwordHash: 'hashed',
      age: 36,
      role: 'admin',
      active: true,
      createdAt,
      updatedAt,
    });

    const result = (await (handler as unknown as (e: APIGatewayProxyEventV2) => Promise<{ statusCode: number; body: string }>)(
      makeAuthEvent(SELF_ID),
    )) as { statusCode: number; body: string };

    expect(result.statusCode).toBe(200);
    const body = JSON.parse(result.body) as {
      data: { id: string; email: string; fullName: string; age: number; role: string; active: boolean; createdAt: string; updatedAt: string };
    };
    expect(body.data).toEqual({
      id: SELF_ID,
      email: 'a@b.com',
      fullName: 'Ada',
      age: 36,
      role: 'admin',
      active: true,
      createdAt: '2026-01-01T00:00:00.000Z',
      updatedAt: '2026-01-02T00:00:00.000Z',
    });
    expect((body.data as unknown as { passwordHash?: string }).passwordHash).toBeUndefined();
  });

  it('passes the auth userId as both actor and target (self-as-target)', async () => {
    mockGetUser.mockResolvedValue({
      id: SELF_ID,
      email: 'a@b.com',
      fullName: 'Ada',
      passwordHash: 'hashed',
      age: null,
      role: 'admin',
      active: true,
      createdAt: new Date('2026-01-01T00:00:00.000Z'),
      updatedAt: new Date('2026-01-01T00:00:00.000Z'),
    });

    await (handler as unknown as (e: APIGatewayProxyEventV2) => Promise<{ statusCode: number; body: string }>)(
      makeAuthEvent(SELF_ID),
    );

    expect(mockGetUser).toHaveBeenCalledWith({ actorUserId: SELF_ID, targetUserId: SELF_ID });
  });
});
