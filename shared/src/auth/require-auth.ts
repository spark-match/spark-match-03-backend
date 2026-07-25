// =============================================================================
// requireAuth - safety middleware that asserts the request is authenticated
// =============================================================================
// Two-tier verification (defense in depth):
//   1. Prefer Lambda Authorizer context (event.requestContext.authorizer.lambda)
//      if present. The Authorizer Lambda has already verified the JWT and
//      put userId/email/role in the context.
//   2. Fallback: if the Authorizer context is missing (e.g. local dev with
//      direct Lambda invocation, or future API Gateway HTTP API v2 with
//      EnableSimpleResponses that drops the context), re-verify the JWT from
//      the Authorization header. This requires the JWT secret loaded via
//      SSM + Secrets Manager on first call, then cached per invocation.
// =============================================================================

import type { Logger } from '@aws-lambda-powertools/logger';
import { ApiError } from '../http/api-error.js';
import { type AuthContext, type LambdaAuthorizerContext } from './auth-context.js';
import { verifyJwt } from './jwt-helpers.js';

let cachedSecret: Uint8Array | null = null;
let pendingSecret: Promise<Uint8Array> | null = null;

async function loadJwtSecret(): Promise<Uint8Array> {
  if (cachedSecret) return cachedSecret;
  if (pendingSecret) return pendingSecret;

  pendingSecret = (async () => {
    const { createSsmReader } = await import('../infra/ssm-reader.js');
    const { createSecretsReader } = await import('../infra/secrets-reader.js');
    const ssm = createSsmReader();
    const secrets = createSecretsReader();
    const secretArn = await ssm.getRequiredString('/spark-match/secret/jwt-arn');
    const secretValue = await secrets.getRequiredString(secretArn);
    const bytes = new TextEncoder().encode(secretValue);
    cachedSecret = bytes;
    pendingSecret = null;
    return bytes;
  })();
  return pendingSecret;
}

/** Reset the cached JWT secret. Intended for tests only. */
export function _resetJwtSecretCache(): void {
  cachedSecret = null;
  pendingSecret = null;
}

export async function requireAuth(event: unknown, logger: Logger): Promise<AuthContext> {
  const ctx = (
    event as { requestContext?: { authorizer?: { lambda?: LambdaAuthorizerContext } } }
  )?.requestContext?.authorizer?.lambda;

  if (ctx?.userId && typeof ctx.userId === 'string') {
    return {
      userId: ctx.userId,
      email: typeof ctx.email === 'string' ? ctx.email : '',
      role: typeof ctx.role === 'string' ? ctx.role : '',
      rawClaims: { ...ctx },
    };
  }

  const path = (event as { requestContext?: { path?: string } })?.requestContext?.path;
  const headers = (event as { headers?: Record<string, string | undefined> })?.headers ?? {};
  const authHeader =
    headers['authorization'] ?? headers['Authorization'] ?? headers['AUTHORIZATION'];

  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    logger.warn('Missing or invalid authorizer context AND no Bearer header', { path });
    throw ApiError.unauthorized('Missing or invalid authentication');
  }

  const token = authHeader.slice(7);
  try {
    const secret = await loadJwtSecret();
    const claims = await verifyJwt(token, secret);
    if (typeof claims.sub !== 'string') {
      logger.warn('JWT missing subject claim', { path });
      throw ApiError.unauthorized('Missing or invalid authentication');
    }
    return {
      userId: claims.sub,
      email: typeof claims.email === 'string' ? claims.email : '',
      role: typeof claims.role === 'string' ? claims.role : '',
      rawClaims: { ...claims },
    };
  } catch (err) {
    if (err instanceof ApiError) throw err;
    logger.warn('JWT verify failed (fallback path)', { path, error: String(err) });
    throw ApiError.unauthorized('Missing or invalid authentication');
  }
}
