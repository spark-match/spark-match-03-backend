import { SecretsManagerClient, GetSecretValueCommand } from '@aws-sdk/client-secrets-manager';

const DEFAULT_CACHE_TTL_MS = 5 * 60 * 1000;

interface CacheEntry {
  value: string;
  expiresAt: number;
}

export interface SecretsReader {
  get(secretId: string): Promise<string>;
  getJson<T>(secretId: string): Promise<T>;
  clearCache(secretId?: string): void;
}

export function createSecretsReader(options?: {
  client?: SecretsManagerClient;
  cacheTtlMs?: number;
}): SecretsReader {
  const client =
    options?.client ??
    new SecretsManagerClient({ region: process.env.AWS_REGION });
  const cacheTtl = options?.cacheTtlMs ?? DEFAULT_CACHE_TTL_MS;
  const cache = new Map<string, CacheEntry>();

  return {
    async get(secretId: string): Promise<string> {
      const now = Date.now();
      const cached = cache.get(secretId);
      if (cached && cached.expiresAt > now) {
        return cached.value;
      }

      const cmd = new GetSecretValueCommand({ SecretId: secretId });
      const response = await client.send(cmd);
      if (!response.SecretString) {
        throw new Error(`Secret ${secretId} has no SecretString`);
      }
      const value = response.SecretString;
      cache.set(secretId, { value, expiresAt: now + cacheTtl });
      return value;
    },

    async getJson<T>(secretId: string): Promise<T> {
      const raw = await this.get(secretId);
      return JSON.parse(raw) as T;
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
