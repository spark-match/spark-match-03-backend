import jwt, { type JwtPayload, type SignOptions } from 'jsonwebtoken';
import { z } from 'zod';

export const JwtPayloadSchema = z.object({
  sub: z.string().uuid(),
  email: z.string().email(),
  iat: z.number().optional(),
  exp: z.number().optional(),
});

export type DecodedJwt = z.infer<typeof JwtPayloadSchema>;

export interface VerifyOptions {
  secret: string;
  issuer?: string;
  audience?: string;
}

export class InvalidTokenError extends Error {
  override readonly name = 'InvalidTokenError';
  constructor(message: string) {
    super(message);
  }
}

export class ExpiredTokenError extends Error {
  override readonly name = 'ExpiredTokenError';
  constructor(message: string) {
    super(message);
  }
}

export function decodeJwt(token: string, options: VerifyOptions): DecodedJwt {
  if (!token) {
    throw new InvalidTokenError('Token is empty');
  }

  const bearerToken = token.startsWith('Bearer ') ? token.slice(7) : token;

  try {
    const verifyOptions: jwt.VerifyOptions = {};
    if (options.issuer) verifyOptions.issuer = options.issuer;
    if (options.audience) verifyOptions.audience = options.audience;

    const decoded = jwt.verify(bearerToken, options.secret, verifyOptions) as JwtPayload;

    const parsed = JwtPayloadSchema.safeParse(decoded);
    if (!parsed.success) {
      throw new InvalidTokenError('Token payload does not match expected schema');
    }

    return parsed.data;
  } catch (err) {
    if (err instanceof jwt.TokenExpiredError) {
      throw new ExpiredTokenError('Token has expired');
    }
    if (err instanceof jwt.JsonWebTokenError) {
      throw new InvalidTokenError(`Token is invalid: ${err.message}`);
    }
    throw err;
  }
}

export function signJwt(
  payload: { sub: string; email: string },
  secret: string,
  expiresIn: SignOptions['expiresIn'] = '24h',
): string {
  return jwt.sign(payload, secret, { expiresIn });
}
