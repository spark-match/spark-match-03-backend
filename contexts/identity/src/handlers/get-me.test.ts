import { describe, it, expect, vi, beforeEach } from 'vitest';

const { mockFindById, mockBuildContext } = vi.hoisted(() => ({
  mockFindById: vi.fn(),
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
        lambda: { userId, email: 'a@b.com', role: 'user' },
      },
    } as APIGatewayProxyEventV2['requestContext'],
  });
}

beforeEach(() => {
  mockFindById.mockReset();
  mockBuildContext.mockReset();
  mockBuildContext.mockResolvedValue({
    userRepository: { findById: mockFindById },
  });
});

describe('GET /me handler', () => {
  it('returns the user profile when found', async () => {
    const createdAt = new Date('2026-01-01T00:00:00.000Z');
    mockFindById.mockResolvedValue({
      id: 'u-1',
      email: 'a@b.com',
      fullName: 'Ada',
      age: 36,
      createdAt,
    });

    const result = (await (handler as unknown as (e: APIGatewayProxyEventV2) => Promise<{ statusCode: number; body: string }>)(
      makeAuthEvent('u-1'),
    )) as { statusCode: number; body: string };

    expect(result.statusCode).toBe(200);
    const body = JSON.parse(result.body) as { data: { id: string; email: string; createdAt: string } };
    expect(body.data).toEqual({
      id: 'u-1',
      email: 'a@b.com',
      fullName: 'Ada',
      age: 36,
      createdAt: '2026-01-01T00:00:00.000Z',
    });
  });

  it('returns 404 when the user is not found', async () => {
    mockFindById.mockResolvedValue(null);

    const result = (await (handler as unknown as (e: APIGatewayProxyEventV2) => Promise<{ statusCode: number; body: string }>)(
      makeAuthEvent('u-missing'),
    )) as { statusCode: number; body: string };

    expect(result.statusCode).toBe(404);
    const body = JSON.parse(result.body) as { error: { code: string } };
    expect(body.error.code).toBe('user_not_found');
  });
});
