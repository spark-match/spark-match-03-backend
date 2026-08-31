import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { Logger } from '@aws-lambda-powertools/logger';
import { Tracer } from '@aws-lambda-powertools/tracer';
import {
  buildHandler,
  parseCorsAllowedOrigins,
  rawPayload,
  selectAllowOrigin,
} from './build-handler.js';
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

  it('honours successStatusCode for endpoints that accept work instead of completing it', async () => {
    // Report generation answers 202: the row is created `pending` and the
    // artefact does not exist yet. A 200 would tell the client the resource is
    // ready and contradict the polling loop the response itself starts.
    const handler = (async () => ({ id: 'r-1' })) as unknown as Parameters<
      typeof buildHandler
    >[0]['handler'];
    const wrapped = buildHandler({
      inputSchema,
      handler,
      logger,
      tracer,
      requireAuth: false,
      enableCors: false,
      successStatusCode: 202,
    });

    const result = await (
      wrapped as unknown as (e: unknown) => Promise<{ statusCode: number; body: string }>
    )(makeEvent({ name: 'Alice' }));

    expect(result.statusCode).toBe(202);
    expect(JSON.parse(result.body).success).toBe(true);
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
      wrapped as unknown as (
        e: unknown,
      ) => Promise<{ statusCode: number; body: string; headers: Record<string, string> }>
    )(ev);

    // With no CORS_ALLOWED_ORIGINS env (and no Origin request header), the
    // middleware defaults to `*` and returns 204 with the static CORS headers.
    expect(result.headers['Access-Control-Allow-Origin']).toBe('*');
    expect(result.headers['Access-Control-Allow-Methods']).toContain('OPTIONS');
  });
});

describe('parseCorsAllowedOrigins', () => {
  it('returns ["*"] when env is undefined', () => {
    expect(parseCorsAllowedOrigins(undefined)).toEqual(['*']);
  });
  it('returns ["*"] when env is empty string', () => {
    expect(parseCorsAllowedOrigins('')).toEqual(['*']);
  });
  it('splits a comma-separated list and trims', () => {
    expect(parseCorsAllowedOrigins('a, b ,c')).toEqual(['a', 'b', 'c']);
  });
  it('returns ["*"] when the only entries are whitespace', () => {
    expect(parseCorsAllowedOrigins('  ,  ')).toEqual(['*']);
  });
  it('preserves "*" as a single entry', () => {
    expect(parseCorsAllowedOrigins('*')).toEqual(['*']);
  });
});

describe('selectAllowOrigin', () => {
  it('returns "*" when allowlist is ["*"]', () => {
    expect(selectAllowOrigin('https://anywhere.example.com', ['*'])).toBe('*');
  });
  it('returns "*" when allowlist is empty', () => {
    expect(selectAllowOrigin('https://x', [])).toBe('*');
  });
  it('returns the request origin when it is in the allowlist', () => {
    expect(
      selectAllowOrigin('https://app.example.com', [
        'https://app.example.com',
        'https://admin.example.com',
      ]),
    ).toBe('https://app.example.com');
  });
  it('returns null when the request origin is not in the allowlist', () => {
    expect(selectAllowOrigin('https://evil.example.com', ['https://app.example.com'])).toBeNull();
  });
  it('returns null when no Origin header is sent', () => {
    expect(selectAllowOrigin(undefined, ['https://app.example.com'])).toBeNull();
  });
});

describe('inline CORS middleware with CORS_ALLOWED_ORIGINS env', () => {
  function makeEventWithOrigin(origin: string | undefined) {
    const ev = makeEvent(null);
    ev.headers = { ...ev.headers, ...(origin ? { origin } : {}) };
    return ev;
  }

  let originalCorsEnv: string | undefined;
  beforeEach(() => {
    originalCorsEnv = process.env.CORS_ALLOWED_ORIGINS;
  });
  afterEach(() => {
    if (originalCorsEnv === undefined) {
      delete process.env.CORS_ALLOWED_ORIGINS;
    } else {
      process.env.CORS_ALLOWED_ORIGINS = originalCorsEnv;
    }
  });

  it('OPTIONS preflight echoes Origin when in allowlist', async () => {
    process.env.CORS_ALLOWED_ORIGINS = 'https://app.example.com,https://admin.example.com';
    // Re-import the module so the const picks up the new env value
    vi.resetModules();
    const fresh = await import('./build-handler.js');
    const wrapped = fresh.buildHandler({
      inputSchema,
      handler: (async () => ({ ok: true })) as unknown as Parameters<
        typeof fresh.buildHandler
      >[0]['handler'],
      logger,
      tracer,
      enableCors: true,
    });
    const ev = makeEventWithOrigin('https://app.example.com');
    ev.requestContext.http.method = 'OPTIONS';
    const result = (await (
      wrapped as unknown as (
        e: unknown,
      ) => Promise<{ statusCode: number; body: string; headers: Record<string, string> }>
    )(ev)) as { headers: Record<string, string> };
    expect(result.headers['Access-Control-Allow-Origin']).toBe('https://app.example.com');
    expect(result.headers['Vary']).toBe('Origin');
  });

  it('OPTIONS preflight omits allow-origin when Origin not in allowlist', async () => {
    process.env.CORS_ALLOWED_ORIGINS = 'https://app.example.com';
    vi.resetModules();
    const fresh = await import('./build-handler.js');
    const wrapped = fresh.buildHandler({
      inputSchema,
      handler: (async () => ({ ok: true })) as unknown as Parameters<
        typeof fresh.buildHandler
      >[0]['handler'],
      logger,
      tracer,
      enableCors: true,
    });
    const ev = makeEventWithOrigin('https://evil.example.com');
    ev.requestContext.http.method = 'OPTIONS';
    const result = (await (
      wrapped as unknown as (
        e: unknown,
      ) => Promise<{ statusCode: number; body: string; headers: Record<string, string> }>
    )(ev)) as { headers: Record<string, string> };
    expect(result.headers['Access-Control-Allow-Origin']).toBeUndefined();
  });

  it('non-OPTIONS response echoes Origin when in allowlist', async () => {
    process.env.CORS_ALLOWED_ORIGINS = 'https://app.example.com';
    vi.resetModules();
    const fresh = await import('./build-handler.js');
    const wrapped = fresh.buildHandler({
      inputSchema,
      handler: (async () => ({ ok: true })) as unknown as Parameters<
        typeof fresh.buildHandler
      >[0]['handler'],
      logger,
      tracer,
      enableCors: true,
    });
    const ev = makeEventWithOrigin('https://app.example.com');
    const result = (await (
      wrapped as unknown as (
        e: unknown,
      ) => Promise<{ statusCode: number; body: string; headers: Record<string, string> }>
    )(ev)) as { headers: Record<string, string> };
    expect(result.headers['Access-Control-Allow-Origin']).toBe('https://app.example.com');
    expect(result.headers['Vary']).toBe('Origin');
  });
});

describe('respuesta en bytes (rawPayload)', () => {
  const PDF = Buffer.from([0x25, 0x50, 0x44, 0x46, 0x2d, 0x31, 0x2e, 0x37, 0x00, 0xff]);

  type RespuestaCruda = {
    statusCode: number;
    body: string;
    isBase64Encoded?: boolean;
    headers?: Record<string, string>;
  };

  function handlerDeBytes(fileName?: string) {
    return buildHandler({
      inputSchema: z.object({}),
      logger,
      tracer,
      handler: async () => rawPayload(PDF, 'application/pdf', fileName),
    });
  }

  it('marca isBase64Encoded y devuelve los bytes intactos', async () => {
    // Sin la bandera, API Gateway entrega el base64 sin decodificar. Y el
    // cuerpo lleva bytes que no son texto valido a proposito: si algo por el
    // camino lo tratara como string, se corromperian.
    const respuesta = (await handlerDeBytes()(makeEvent(null))) as RespuestaCruda;

    expect(respuesta.isBase64Encoded).toBe(true);
    expect(Buffer.from(respuesta.body, 'base64').equals(PDF)).toBe(true);
  });

  it('el Content-Type del fichero gana al de CORS', async () => {
    // El middleware de CORS mete `application/json` con `??=`. Si dejara de
    // serlo, un PDF se serviria como JSON.
    const respuesta = (await handlerDeBytes()(makeEvent(null))) as RespuestaCruda;

    expect(respuesta.headers?.['Content-Type']).toBe('application/pdf');
  });

  it('sin fileName no manda Content-Disposition', async () => {
    const respuesta = (await handlerDeBytes()(makeEvent(null))) as RespuestaCruda;

    expect(respuesta.headers?.['Content-Disposition']).toBeUndefined();
  });

  it('con fileName lo manda como descarga', async () => {
    const respuesta = (await handlerDeBytes('informe.pdf')(makeEvent(null))) as RespuestaCruda;

    expect(respuesta.headers?.['Content-Disposition']).toBe('attachment; filename="informe.pdf"');
  });

  it('un objeto normal sigue saliendo en el sobre JSON', async () => {
    // La deteccion mira `kind === 'raw'` Y que el cuerpo sea un Buffer. Un
    // payload de negocio que por casualidad tuviera `kind: 'raw'` no debe
    // colarse por esta rama.
    const h = buildHandler({
      inputSchema: z.object({}),
      logger,
      tracer,
      handler: async () => ({ kind: 'raw', body: 'no soy un Buffer' }),
    });

    const respuesta = (await h(makeEvent(null))) as RespuestaCruda;

    expect(respuesta.isBase64Encoded).toBeUndefined();
    expect(JSON.parse(respuesta.body).success).toBe(true);
  });
});
