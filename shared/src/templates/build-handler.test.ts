import { describe, it, expect } from 'vitest';
import { Logger } from '@aws-lambda-powertools/logger';
import { Tracer } from '@aws-lambda-powertools/tracer';
import { buildHandler } from './build-handler.js';
import { z } from 'zod';

const inputSchema = z.object({ name: z.string() });

const logger = new Logger({ serviceName: 'test' });
const tracer = new Tracer({ serviceName: 'test' });

function makeEvent(
  body: object | null,
  authContext?: Record<string, string>,
): Parameters<ReturnType<typeof buildHandler>>[0] {
  return {
    version: '2.0',
    routeKey: 'POST /test',
    rawPath: '/test',
    rawQueryString: '',
    headers: { 'content-type': 'application/json' },
    requestContext: {
      accountId: '123',
      apiId: 'abc',
      domainName: 'abc.execute-api.us-east-1.amazonaws.com',
      domainPrefix: 'abc',
      http: {
        method: 'POST',
        path: '/test',
        protocol: 'HTTP/1.1',
        sourceIp: '127.0.0.1',
        userAgent: 'test',
      },
      requestId: 'req-test-123',
      routeKey: 'POST /test',
      stage: '$default',
      time: '01/Jan/2026:00:00:00 +0000',
      timeEpoch: 0,
      ...(authContext ? { authorizer: { lambda: authContext } } : {}),
    },
    body: body ? JSON.stringify(body) : null,
    isBase64Encoded: false,
  } as unknown as Parameters<ReturnType<typeof buildHandler>>[0];
}

describe('buildHandler', () => {
  it('calls handler with parsed input on valid body', async () => {
    const handler = (async () => ({ ok: true })) as unknown as Parameters<
      typeof buildHandler
    >[0]['handler'];
    const wrapped = buildHandler({
      inputSchema,
      handler,
      logger,
      tracer,
      requireAuth: false,
      enableCors: false,
    });

    const result = await (
      wrapped as unknown as (e: unknown) => Promise<{ statusCode: number; body: string }>
    )(makeEvent({ name: 'Alice' }));

    expect(result.statusCode).toBe(200);
    const body = JSON.parse(result.body);
    expect(body.success).toBe(true);
    expect(body.data).toEqual({ ok: true });
    expect(body.meta.requestId).toBe('req-test-123');
  });

  it('returns 400 on invalid body', async () => {
    const handler = (async () => ({ ok: true })) as unknown as Parameters<
      typeof buildHandler
    >[0]['handler'];
    const wrapped = buildHandler({
      inputSchema,
      handler,
      logger,
      tracer,
      enableCors: false,
    });

    const result = await (
      wrapped as unknown as (e: unknown) => Promise<{ statusCode: number; body: string }>
    )(makeEvent({ name: 123 }));

    expect(result.statusCode).toBe(400);
    const body = JSON.parse(result.body);
    expect(body.success).toBe(false);
    expect(body.error.code).toBe('bad_request');
    expect(body.error.details.length).toBeGreaterThan(0);
  });

  it('throws 401 when requireAuth=true and no authorizer context', async () => {
    const handler = (async () => ({ ok: true })) as unknown as Parameters<
      typeof buildHandler
    >[0]['handler'];
    const wrapped = buildHandler({
      inputSchema,
      handler,
      logger,
      tracer,
      requireAuth: true,
      enableCors: false,
    });

    const result = await (
      wrapped as unknown as (e: unknown) => Promise<{ statusCode: number; body: string }>
    )(makeEvent({ name: 'Alice' }));

    expect(result.statusCode).toBe(401);
  });

  it('returns 500 and logs unhandled non-ApiError exceptions', async () => {
    const throwingHandler = (async () => {
      throw new Error('boom-unexpected');
    }) as unknown as Parameters<typeof buildHandler>[0]['handler'];
    const wrapped = buildHandler({
      inputSchema,
      handler: throwingHandler,
      logger,
      tracer,
      enableCors: false,
    });

    const result = await (
      wrapped as unknown as (e: unknown) => Promise<{ statusCode: number; body: string }>
    )(makeEvent({ name: 'Alice' }));

    expect(result.statusCode).toBe(500);
    const body = JSON.parse(result.body);
    expect(body.success).toBe(false);
    expect(body.error.code).toBe('internal');
  });

  it('handles OPTIONS preflight by setting CORS headers on the response', async () => {
    const handler = (async () => ({ ok: true })) as unknown as Parameters<
      typeof buildHandler
    >[0]['handler'];
    const wrapped = buildHandler({
      inputSchema,
      handler,
      logger,
      tracer,
      enableCors: true,
    });

    const ev = makeEvent(null);
    ev.requestContext.http.method = 'OPTIONS';

    const result = await (
      wrapped as unknown as (e: unknown) => Promise<{ statusCode: number; body: string; headers: Record<string, string> }>
    )(ev);

    // The inline CORS middleware's `before` hook sets the response to 204;
    // verify the headers are applied regardless of which path short-circuits.
    expect(result.headers['Access-Control-Allow-Origin']).toBe('*');
    expect(result.headers['Access-Control-Allow-Methods']).toContain('OPTIONS');
  });
});
