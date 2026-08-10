// =============================================================================
// buildHandler - Middy pipeline factory for Spark Match Lambda handlers
// =============================================================================
// Responsibilities (in order):
//   1. httpHeaderNormalizer     - lowercase keys, strip Content-Length
//   2. injectLambdaContext      - Powertools: correlationId, requestId
//   3. captureLambdaHandler     - X-Ray subsegments
//   4. requireAuth (optional)   - extracts AuthContext, throws 401 if missing
//   5. validateInput (auto)     - Zod schema validation of inputSchema
//   6. handler                  - user business logic
//   7. httpErrorHandler         - catch thrown ApiError -> formatError
//
// Handlers receive (input, event, auth?) and return a typed payload. The
// requestId is always required on the response envelope; "unknown" is the
// last-resort fallback when AWS does not include one.
// =============================================================================

import middy from '@middy/core';
import httpErrorHandler from '@middy/http-error-handler';
import httpHeaderNormalizer from '@middy/http-header-normalizer';
import type { Logger } from '@aws-lambda-powertools/logger';
import type { Tracer } from '@aws-lambda-powertools/tracer';
import { injectLambdaContext } from '@aws-lambda-powertools/logger/middleware';
import { captureLambdaHandler } from '@aws-lambda-powertools/tracer/middleware';
import type { APIGatewayProxyEventV2, APIGatewayProxyResultV2 } from 'aws-lambda';
import type { ZodType } from 'zod';
import { type AuthContext, requireAuth } from '../auth/index.js';
import { ApiError, formatError, formatResponse } from '../http/index.js';
import { validatePayload } from '../events/schema-validator.js';

export type Handler<TInput, TOutput> = (
  input: TInput,
  event: APIGatewayProxyEventV2,
  auth: AuthContext | undefined,
) => Promise<TOutput>;

export interface HandlerConfig<TInput, TOutput> {
  /** Optional name for logging context. */
  name?: string;
  /** Zod schema for request body validation. */
  inputSchema: ZodType;
  /**
   * Optional Zod schema for the response payload. Not used at runtime
   * (responses are not re-validated today), but exposed for the OpenAPI
   * generator (`scripts/generate-openapi.ts`) to emit per-endpoint output
   * schemas. Mirrors `inputSchema` semantically; see ADR-013.
   */
  outputSchema?: ZodType;
  /** The business logic. */
  handler: Handler<TInput, TOutput>;
  /** Logger instance (per-context). */
  logger: Logger;
  /** Tracer instance (per-context). */
  tracer: Tracer;
  /** When true, the event must carry a Lambda Authorizer context or a valid Bearer. */
  requireAuth?: boolean;
  /** When true (default), handle CORS preflight + add CORS headers on responses. */
  enableCors?: boolean;
  /**
   * Status code for a successful response. Defaults to 200.
   *
   * Exists for endpoints that accept work rather than complete it: report
   * generation answers `202` because the row is created `pending` and the
   * artefact does not exist yet (ADR-019 D4). Answering 200 there would tell
   * the client the resource is ready, and the polling loop that follows would
   * be contradicting the response that started it.
   */
  successStatusCode?: number;
}

interface ResponseLike {
  statusCode: number;
  headers: Record<string, string>;
  body: string;
}

const asResponse = (r: unknown): ResponseLike => r as ResponseLike;

function parseBody(body: unknown): unknown {
  if (body === null || body === undefined) return {};
  if (typeof body === 'string') return JSON.parse(body) as unknown;
  return body;
}

/**
 * Static CORS headers. The `Access-Control-Allow-Origin` header is
 * dynamic (depends on the request's `Origin` and the allowlist), so
 * the per-request middleware computes it via `selectAllowOrigin()`
 * and merges the rest from this constant.
 */
const CORS_STATIC_HEADERS = {
  'Access-Control-Allow-Headers': 'Content-Type, Authorization, X-Correlation-Id',
  'Access-Control-Allow-Methods': 'GET,POST,PUT,PATCH,DELETE,OPTIONS',
  'Access-Control-Expose-Headers': 'X-Correlation-Id',
  'Content-Type': 'application/json',
  'X-Content-Type-Options': 'nosniff',
  'X-Frame-Options': 'DENY',
} as const;

/**
 * Parse the `CORS_ALLOWED_ORIGINS` env var (comma-separated) into an
 * array of trimmed, non-empty origins. `*` and an unset/empty value
 * both produce `['*']` (any origin). Trimmed for resilience against
 * deploy-time whitespace.
 */
export function parseCorsAllowedOrigins(env: string | undefined): string[] {
  if (!env) return ['*'];
  const parts = env
    .split(',')
    .map((o) => o.trim())
    .filter((o) => o.length > 0);
  if (parts.length === 0) return ['*'];
  return parts;
}

/**
 * Pick the `Access-Control-Allow-Origin` value for a given request
 * `Origin` header:
 *  - If the allowlist is `['*']`, return `*` (any origin).
 *  - Else if the request's `Origin` is in the allowlist, echo it back.
 *  - Else return `null` (caller MUST omit the header so the browser
 *    blocks the response).
 */
export function selectAllowOrigin(
  requestOrigin: string | undefined,
  allowedOrigins: string[],
): string | null {
  if (allowedOrigins.length === 0 || allowedOrigins.includes('*')) {
    return '*';
  }
  if (requestOrigin && allowedOrigins.includes(requestOrigin)) {
    return requestOrigin;
  }
  return null;
}

/**
 * Read CORS configuration from the Lambda environment. Cached at module
 * load so the middleware doesn't re-parse on every request.
 */
const CORS_ALLOWED_ORIGINS = parseCorsAllowedOrigins(process.env.CORS_ALLOWED_ORIGINS);

/**
 * Inline CORS middleware. Avoids the @middy/http-cors middleware because
 * the spark-match backend needs:
 *  - dynamic `Access-Control-Allow-Origin` (echo request `Origin` if
 *    allowlisted) for prod hardening — `@middy/http-cors` doesn't
 *    support allowlist semantics without extra config
 *  - to also apply CORS headers on `onError` paths so 4xx/5xx
 *    responses don't leak CORS failures
 *
 * The allowlist is sourced from `CORS_ALLOWED_ORIGINS` (env var), set
 * by the `CorsAllowedOrigins` CloudFormation parameter on the root
 * stack and propagated to every Lambda's `Environment` block.
 */
function inlineCorsMiddleware(): middy.MiddlewareObj<
  APIGatewayProxyEventV2,
  APIGatewayProxyResultV2
> {
  const applyHeaders = (
    request: middy.Request<APIGatewayProxyEventV2, APIGatewayProxyResultV2>,
  ): void => {
    if (request.response === undefined || request.response === null) return;
    const resp = asResponse(request.response);
    const headers = resp.headers ?? {};
    // Compute the dynamic allow-origin from the request's Origin header
    const requestOrigin = request.event.headers?.['origin'] ?? request.event.headers?.['Origin'];
    const allowOrigin = selectAllowOrigin(requestOrigin, CORS_ALLOWED_ORIGINS);
    if (allowOrigin !== null) {
      // `??=` so a handler-set header is preserved
      headers['Access-Control-Allow-Origin'] ??= allowOrigin;
      headers['Vary'] = 'Origin';
    }
    for (const [k, v] of Object.entries(CORS_STATIC_HEADERS)) {
      headers[k] ??= v;
    }
    resp.headers = headers;
  };
  return {
    before: async (request) => {
      const method = request.event.requestContext?.http?.method;
      if (method === 'OPTIONS') {
        // Preflight: compute allow-origin from request's Origin header
        const requestOrigin =
          request.event.headers?.['origin'] ?? request.event.headers?.['Origin'];
        const allowOrigin = selectAllowOrigin(requestOrigin, CORS_ALLOWED_ORIGINS);
        const preflightHeaders: Record<string, string> = {};
        if (allowOrigin !== null) {
          preflightHeaders['Access-Control-Allow-Origin'] = allowOrigin;
          preflightHeaders['Vary'] = 'Origin';
        }
        for (const [k, v] of Object.entries(CORS_STATIC_HEADERS)) {
          preflightHeaders[k] = v;
        }
        request.response = {
          statusCode: 204,
          headers: preflightHeaders,
          body: '',
        };
      }
    },
    after: async (request) => {
      applyHeaders(request);
    },
    onError: async (request) => {
      if (request.response === undefined || request.response === null) return;
      applyHeaders(request);
    },
  };
}

/**
 * Builds a Middy-wrapped Lambda handler with the standard Spark Match pipeline.
 * Returns the wrapped handler ready to export from a `handlers/<name>.ts`.
 */
export function buildHandler<TInput, TOutput>(
  config: HandlerConfig<TInput, TOutput>,
): middy.MiddyfiedHandler<APIGatewayProxyEventV2, APIGatewayProxyResultV2> {
  const baseHandler = async (event: APIGatewayProxyEventV2): Promise<APIGatewayProxyResultV2> => {
    const requestId = event.requestContext?.requestId ?? 'unknown';
    try {
      const rawBody = parseBody(event.body);
      const input = validatePayload(config.inputSchema, rawBody) as TInput;
      const auth = config.requireAuth ? await requireAuth(event, config.logger) : undefined;
      const result = await config.handler(input, event, auth);
      return {
        statusCode: config.successStatusCode ?? 200,
        body: JSON.stringify(formatResponse(result, requestId)),
        headers: { 'Content-Type': 'application/json' },
      };
    } catch (err) {
      const statusCode = err instanceof ApiError ? err.statusCode : 500;
      // Log unhandled exceptions so they appear in CloudWatch logs. The
      // httpErrorHandler middleware logs ApiError; for non-ApiError errors
      // (e.g. DB failures, unexpected throws) we need an explicit log call
      // or the error stays invisible in Lambda logs.
      if (!(err instanceof ApiError)) {
        config.logger.error('unhandled exception', {
          err,
          requestId,
          handlerName: config.name,
          routeKey: event.routeKey,
          httpMethod: event.requestContext?.http?.method,
          path: event.rawPath,
        });
      }
      return {
        statusCode,
        body: JSON.stringify(formatError(err, requestId)),
        headers: { 'Content-Type': 'application/json' },
      };
    }
  };

  const pipeline = middy<APIGatewayProxyEventV2, APIGatewayProxyResultV2, Error>(baseHandler)
    .use(httpHeaderNormalizer())
    .use(injectLambdaContext(config.logger, { clearState: true }))
    .use(captureLambdaHandler(config.tracer));

  if (config.enableCors !== false) {
    pipeline.use(inlineCorsMiddleware());
  }

  pipeline.use(httpErrorHandler());

  return pipeline;
}
