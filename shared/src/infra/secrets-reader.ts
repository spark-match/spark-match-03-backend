// =============================================================================
// Secrets Manager reader with error mapping
// =============================================================================
// Wraps the AWS SDK GetSecretValueCommand so any thrown error is surfaced
// as ApiError.awsUnavailable (code: aws.unavailable, meta.dependency).
// Caches SecretString values per secretId for 5 minutes by default.
// =============================================================================

import { SecretsManagerClient, GetSecretValueCommand } from '@aws-sdk/client-secrets-manager';
import { ApiError } from '../http/api-error.js';

const DEFAULT_CACHE_TTL_MS = 5 * 60 * 1000;
const DEPENDENCY = 'Secrets Manager';

interface CacheEntry {
  value: string;
  expiresAt: number;
}

export interface SecretsReader {
  get(secretId: string): Promise<string>;
  getJson<T>(secretId: string): Promise<T>;
  getRequiredString(secretId: string): Promise<string>;
  clearCache(secretId?: string): void;
}

export function createSecretsReader(options?: {
  client?: SecretsManagerClient;
  cacheTtlMs?: number;
}): SecretsReader {
  const client = options?.client ?? new SecretsManagerClient({ region: process.env.AWS_REGION });
  const cacheTtl = options?.cacheTtlMs ?? DEFAULT_CACHE_TTL_MS;
  const cache = new Map<string, CacheEntry>();

  async function fetchSecret(secretId: string): Promise<string> {
    try {
      const cmd = new GetSecretValueCommand({ SecretId: secretId });
      const response = await client.send(cmd);
      if (!response.SecretString) {
        throw new Error(`Secret ${secretId} has no SecretString`);
      }
      return response.SecretString;
    } catch (err) {
      if (err instanceof ApiError) throw err;
      throw ApiError.awsUnavailable(DEPENDENCY, err);
    }
  }

  return {
    async get(secretId: string): Promise<string> {
      const now = Date.now();
      const cached = cache.get(secretId);
      if (cached && cached.expiresAt > now) {
        return cached.value;
      }

      const value = await fetchSecret(secretId);
      cache.set(secretId, { value, expiresAt: now + cacheTtl });
      return value;
    },

    async getJson<T>(secretId: string): Promise<T> {
      const raw = await this.get(secretId);
      return JSON.parse(raw) as T;
    },

    async getRequiredString(secretId: string): Promise<string> {
      const value = await this.get(secretId);
      if (value === undefined || value === '') {
        throw ApiError.internal(`Required secret is empty: ${secretId}`);
      }
      return value;
    },

    clearCache(secretId?: string): void {
      if (secretId) {
        cache.delete(secretId);
      } else {
        cache.clear();
      }
    },
  };
}
