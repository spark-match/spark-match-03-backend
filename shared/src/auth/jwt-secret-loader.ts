// =============================================================================
// JWT secret loader - module-level cache for the JWT signing secret.
// =============================================================================
// Used by:
//   - requireAuth middleware (Bearer header fallback path)
//   - HttpApi Authorizer Lambda (verifies the incoming JWT before forwarding
//     the request to the protected handler).
//
// The cache is keyed at module scope, so a single warm Lambda execution
// context only loads the secret once per cold start. The pendingSecret
// ref prevents thundering-herd on concurrent first calls.
// =============================================================================

import { createSsmReader } from '../infra/ssm-reader.js';
import { createSecretsReader } from '../infra/secrets-reader.js';
import { ssmConfigPath } from '../infra/ssm-config-path.js';

let cachedSecret: Uint8Array | null = null;
let pendingSecret: Promise<Uint8Array> | null = null;

export async function loadJwtSecret(): Promise<Uint8Array> {
  if (cachedSecret) return cachedSecret;
  if (pendingSecret) return pendingSecret;

  pendingSecret = (async () => {
    const ssm = createSsmReader();
    const secrets = createSecretsReader();
    const secretArn = await ssm.getRequiredString(ssmConfigPath('jwt-secret-arn'));
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