// =============================================================================
// audit.ts handler - unit tests
// =============================================================================
// Mocks auditService via composition; tests that:
//   - 401 when no auth context (shouldn't happen with Authorizer wired,
//     but the middleware fallback exercises requireAuth)
//   - passes query params to the service
//   - converts the returned AuditEntry (with Date) to the JSON-safe shape
// =============================================================================

import { describe, it, expect, vi } from 'vitest';

const { mockListAuditEntries } = vi.hoisted(() => ({
  mockListAuditEntries: vi.fn(),
}));

const mockBuildContext = vi.hoisted(() => vi.fn());

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
    captureAsyncFunc(_name: string, fn: () => Promise<unknown>) {
      return fn();
    }
  },
}));

import type { APIGatewayProxyEventV2 } from 'aws-lambda';
import { handler } from './audit.js';

function makeEvent(overrides: Partial<APIGatewayProxyEventV2> = {}): APIGatewayProxyEventV2 {
  return {
    version: '2.0',
    routeKey: 'GET /v1/audit',
    rawPath: '/v1/audit',
    rawQueryString: '',
    headers: {},
    requestContext: {
      accountId: '123',
      apiId: 'api',
      domainName: 'api.example.com',
      domainPrefix: 'api',
      http: { method: 'GET', path: '/v1/audit', protocol: 'HTTP/1.1', sourceIp: '127.0.0.1', userAgent: 'test' },
      requestId: 'req-1',
      routeKey: 'GET /v1/audit',
      stage: '$default',
      time: '01/Jan/2026:00:00:00 +0000',
      timeEpoch: 0,
    } as APIGatewayProxyEventV2['requestContext'],
    body: undefined,
    isBase64Encoded: false,
    ...overrides,
  } as APIGatewayProxyEventV2;
}

function makeAuthEvent(authOverrides: Record<string, string> = {}) {
  return makeEvent({
    requestContext: {
      ...makeEvent().requestContext,
      authorizer: {
        lambda: {
          userId: 'admin-1',
          email: 'admin@example.com',
          role: 'admin',
          ...authOverrides,
        },
      },
    } as APIGatewayProxyEventV2['requestContext'],
  });
}

beforeEach(() => {
  mockListAuditEntries.mockReset();
  mockBuildContext.mockReset();
});

describe('audit handler', () => {
  it('returns 401 when no auth context (requireAuth triggered)', async () => {
    mockBuildContext.mockResolvedValue({
      auditService: { listAuditEntries: mockListAuditEntries },
    });
    const event = makeEvent(); // no authorizer.lambda
    const result = (await (handler as unknown as (e: unknown) => Promise<unknown>)(event)) as {
      statusCode: number;
      body: string;
    };
    expect(result.statusCode).toBe(401);
    expect(mockListAuditEntries).not.toHaveBeenCalled();
  });

  it('parses queryStringParameters into filters and returns the JSON-safe shape', async () => {
    mockListAuditEntries.mockResolvedValue({
      entries: [
        {
          id: '12345',
          occurredAt: new Date('2026-07-30T16:00:00Z'),
          action: 'user.login',
          actorUserId: null,
          subjectUserId: '11111111-1111-4111-8111-111111111111',
          metadata: { ip: '1.2.3.4', userAgent: 'curl' },
        },
      ],
      nextCursor: 'opaque-cursor',
    });
    mockBuildContext.mockResolvedValue({
      auditService: { listAuditEntries: mockListAuditEntries },
    });

    const event = makeAuthEvent({
      userId: 'admin-1',
      email: 'admin@example.com',
      role: 'admin',
    });
    event.queryStringParameters = {
      actorUserId: 'a-uuid',
      action: 'user.login',
      limit: '25',
    } as Record<string, string>;
    const result = (await (handler as unknown as (e: unknown) => Promise<unknown>)(event)) as {
      statusCode: number;
      body: string;
    };
    expect(result.statusCode).toBe(200);
    expect(mockListAuditEntries).toHaveBeenCalledWith(
      { userId: 'admin-1', email: 'admin@example.com', role: 'admin' },
      {
        actorUserId: 'a-uuid',
        subjectUserId: undefined,
        action: 'user.login',
        since: undefined,
        until: undefined,
        limit: 25,
        cursor: undefined,
      },
    );
    const body = JSON.parse(result.body);
    expect(body.success).toBe(true);
    expect(body.data.entries[0]).toMatchObject({
      id: '12345',
      occurredAt: '2026-07-30T16:00:00.000Z',
    });
    expect(body.data.nextCursor).toBe('opaque-cursor');
  });

  it('defaults limit to undefined when queryStringParameters is missing', async () => {
    mockListAuditEntries.mockResolvedValue({ entries: [], nextCursor: null });
    mockBuildContext.mockResolvedValue({
      auditService: { listAuditEntries: mockListAuditEntries },
    });

    const event = makeAuthEvent();
    event.queryStringParameters = undefined;
    await (handler as unknown as (e: unknown) => Promise<unknown>)(event);
    expect(mockListAuditEntries).toHaveBeenCalled();
    const callFilters = mockListAuditEntries.mock.calls[0][1];
    expect(callFilters.limit).toBeUndefined();
  });
});
