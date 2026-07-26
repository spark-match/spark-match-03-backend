// =============================================================================
// JWT signer - factory that wraps the shared signJwt helper
// =============================================================================
// Caches the secret bytes per Lambda invocation so handlers do not
// re-fetch from Secrets Manager on every request. The cache lives
// inside this module (singleton) and is intentionally NOT shared
// across contexts - each Lambda has its own container.
//
// Used by:
//   - contexts/identity/src/composition.ts (registers `signForUser`
//     on IdentityContext).
//   - contexts/identity/src/handlers/login.ts (consumes ctx.signForUser).
//
// Future contexts that need to mint tokens (e.g. an admin "switch user"
// Lambda) should construct their own JwtSigner with their own SSM-stored
// secret ARN rather than share this one.
// =============================================================================

import {
  createSecretsReader,
  withAwsErrorMapping,
  type SecretsReader,
} from '@spark-match/shared/infra';
import { signJwt, type SignOptions } from '@spark-match/shared/auth';

export interface JwtSigner {
  sign(options: SignOptions): Promise<string>;
  /** Test seam. */
  clearCache(): void;
}

const DEPENDENCY = 'Secrets Manager';

export function createJwtSigner(options: {
  secretArn: string;
  secrets?: SecretsReader;
  cacheKey?: string;
}): JwtSigner {
  const secrets = options.secrets ?? createSecretsReader();
  const _cacheKey = options.cacheKey ?? options.secretArn;

  let cachedSecret: Uint8Array | null = null;
  let pending: Promise<Uint8Array> | null = null;

  async function loadSecret(): Promise<Uint8Array> {
    if (cachedSecret) return cachedSecret;
    if (pending) return pending;

    pending = (async () => {
      const value = await withAwsErrorMapping(DEPENDENCY, () =>
        secrets.getRequiredString(options.secretArn),
      );
      const bytes = new TextEncoder().encode(value);
      cachedSecret = bytes;
      pending = null;
      return bytes;
    })();
    return pending;
  }

  return {
    async sign(signOptions: SignOptions): Promise<string> {
      const secret = await loadSecret();
      return signJwt(secret, signOptions);
    },
    clearCache(): void {
      cachedSecret = null;
      pending = null;
    },
  };
}
