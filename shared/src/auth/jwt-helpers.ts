// =============================================================================
// JWT helpers - sign and verify HS256 tokens using `jose`
// =============================================================================
// Used by:
//   - contexts/identity/src/handlers/login.ts      -> signJwt() on login
//   - contexts/identity/src/handlers/change-password.ts -> signJwt() on
//     re-authentication (future)
//   - contexts/authorizer/src/handler.ts           -> verifyJwt() per request
//
// The HS256 secret is loaded from AWS Secrets Manager (ARN passed via env
// JWT_SECRET_ARN). The secret MUST be at least 32 bytes for HS256.
// =============================================================================

import { jwtVerify, SignJWT, type JWTPayload } from 'jose';
import { ApiError } from '../http/api-error.js';

/**
 * Default JWT lifetime (24 hours).
 *
 * Exported so callers (e.g. `composition.ts`) can reference the same
 * value rather than re-define it. PR-#80 (Sprint 3 P3 close-out)
 * removed the prior 1h default in `signJwt()` to prevent accidental
 * 1h tokens if a new caller forgets to pass `expiresInSeconds`.
 */
export const DEFAULT_JWT_EXPIRES_SECONDS = 86400;

export interface SparkMatchJwtClaims extends JWTPayload {
  sub: string;
  email: string;
  role: string;
  iat?: number;
  exp?: number;
}

export interface SignOptions {
  /** Subject (user id). */
  subject: string;
  /** User email. */
  email: string;
  /** User role (e.g. 'admin'). */
  role: string;
  /** Token lifetime in seconds. Default: `DEFAULT_JWT_EXPIRES_SECONDS` (24h). */
  expiresInSeconds?: number;
  /** Additional JWT claims to embed. */
  extraClaims?: Record<string, unknown>;
}

/**
 * Signs a JWT with HS256 using the provided secret.
 * The secret must be at least 32 bytes (256 bits) for HS256.
 */
export async function signJwt(secret: Uint8Array, options: SignOptions): Promise<string> {
  if (secret.byteLength < 32) {
    throw new Error('HS256 secret must be at least 32 bytes');
  }

  const now = Math.floor(Date.now() / 1000);
  const exp = now + (options.expiresInSeconds ?? DEFAULT_JWT_EXPIRES_SECONDS);

  return new SignJWT({
    email: options.email,
    role: options.role,
    ...options.extraClaims,
  })
    .setProtectedHeader({ alg: 'HS256', typ: 'JWT' })
    .setSubject(options.subject)
    .setIssuedAt(now)
    .setExpirationTime(exp)
    .setIssuer('spark-match-backend')
    .setAudience('spark-match-api')
    .sign(secret);
}

/**
 * Verifies a JWT and returns its claims. Throws ApiError.unauthorized on failure.
 */
export async function verifyJwt(token: string, secret: Uint8Array): Promise<SparkMatchJwtClaims> {
  try {
    const { payload } = await jwtVerify(token, secret, {
      algorithms: ['HS256'],
      issuer: 'spark-match-backend',
      audience: 'spark-match-api',
    });

    if (typeof payload.sub !== 'string') {
      throw ApiError.unauthorized('Missing subject claim');
    }

    return payload as SparkMatchJwtClaims;
  } catch (err) {
    if (err instanceof ApiError) throw err;
    throw ApiError.unauthorized('Invalid or expired token');
  }
}
