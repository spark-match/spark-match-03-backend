import { describe, it, expect, vi, beforeEach } from 'vitest';

const { mockRegister, mockBuildContext } = vi.hoisted(() => ({
  mockRegister: vi.fn(),
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
import { handler } from './register.js';

function makeEvent(body: unknown): APIGatewayProxyEventV2 {
  return {
    version: '2.0',
    routeKey: 'POST /register',
    rawPath: '/register',
    rawQueryString: '',
    headers: {},
    requestContext: {
      accountId: '123',
      apiId: 'api',
      domainName: 'api.example.com',
      domainPrefix: 'api',
      http: { method: 'POST', path: '/register', protocol: 'HTTP/1.1', sourceIp: '127.0.0.1', userAgent: 'test' },
      requestId: 'req-1',
      routeKey: 'POST /register',
      stage: '$default',
      time: '01/Jan/2026:00:00:00 +0000',
      timeEpoch: 0,
    } as APIGatewayProxyEventV2['requestContext'],
    body: typeof body === 'string' ? body : JSON.stringify(body),
    isBase64Encoded: false,
  } as APIGatewayProxyEventV2;
}

beforeEach(() => {
  mockRegister.mockReset();
  mockBuildContext.mockReset();
  mockBuildContext.mockResolvedValue({
    logger: { info: vi.fn(), error: vi.fn() },
    userService: { register: mockRegister },
  });
});

describe('POST /register handler', () => {
  it('returns the registered user on success', async () => {
    const createdAt = new Date('2026-01-01T00:00:00.000Z');
    mockRegister.mockResolvedValue({
      id: '3a8e6c4e-1f3a-4f0e-9a3d-1c2b3a4d5e6f',
      email: 'a@b.com',
      fullName: 'Ada',
      role: 'student',
      createdAt,
    });

    const result = (await (handler as unknown as (e: APIGatewayProxyEventV2) => Promise<{ statusCode: number; body: string }>)(
      makeEvent({
        email: 'a@b.com',
        password: 'supersecret123',
        fullName: 'Ada',
      }),
    )) as { statusCode: number; body: string };

    expect(result.statusCode).toBe(200);
    const body = JSON.parse(result.body) as { data: { id: string; createdAt: string; role: string } };
    expect(body.data.createdAt).toBe('2026-01-01T00:00:00.000Z');
    // La respuesta dice el rol que acaba de conceder. Antes callaba, y cuando el
    // rol concedido era 'admin' ese silencio fue parte de que nadie lo viera.
    expect(body.data.role).toBe('student');
  });

  it('rejects invalid input with 400', async () => {
    const result = (await (handler as unknown as (e: APIGatewayProxyEventV2) => Promise<{ statusCode: number; body: string }>)(
      makeEvent({ email: 'not-an-email', password: 'short' }),
    )) as { statusCode: number; body: string };

    expect(result.statusCode).toBe(400);
  });
});
