import { describe, it, expect, vi, beforeEach } from 'vitest';

const send = vi.fn();

vi.mock('@aws-sdk/client-secrets-manager', () => {
  const GetSecretValueCommand = vi
    .fn()
    .mockImplementation((input: { SecretId: string }) => ({ input }));
  const SecretsManagerClient = vi.fn().mockImplementation(() => ({ send }));
  return { SecretsManagerClient, GetSecretValueCommand };
});

import { SecretsManagerClient, GetSecretValueCommand } from '@aws-sdk/client-secrets-manager';
import { createSecretsReader } from './secrets-reader.js';
import { ApiError } from '../http/api-error.js';

const mockedClient = vi.mocked(SecretsManagerClient);
const mockedCommand = vi.mocked(GetSecretValueCommand);

beforeEach(() => {
  send.mockReset();
  mockedClient.mockClear();
  mockedCommand.mockClear();
});

describe('createSecretsReader', () => {
  it('creates a default SecretsManagerClient when none is provided', () => {
    process.env.AWS_REGION = 'us-east-1';
    createSecretsReader();
    expect(mockedClient).toHaveBeenCalledWith({ region: 'us-east-1' });
  });

  it('uses the provided client', () => {
    const custom = { send: vi.fn() } as unknown as SecretsManagerClient;
    createSecretsReader({ client: custom });
    expect(mockedClient).not.toHaveBeenCalled();
  });

  describe('get', () => {
    it('fetches the secret and caches it', async () => {
      send.mockResolvedValue({ SecretString: 'shh' });
      const reader = createSecretsReader();

      const result = await reader.get('my-secret');

      expect(result).toBe('shh');
      expect(send).toHaveBeenCalledOnce();
      const cmd = send.mock.calls[0]![0] as { input: { SecretId: string } };
      expect(cmd.input.SecretId).toBe('my-secret');
    });

    it('returns the cached value on subsequent calls', async () => {
      send.mockResolvedValue({ SecretString: 'cached-value' });
      const reader = createSecretsReader();

      const first = await reader.get('my-secret');
      const second = await reader.get('my-secret');

      expect(first).toBe('cached-value');
      expect(second).toBe('cached-value');
      expect(send).toHaveBeenCalledOnce();
    });

    it('re-fetches after the cache entry expires', async () => {
      send
        .mockResolvedValueOnce({ SecretString: 'first' })
        .mockResolvedValueOnce({ SecretString: 'second' });
      const reader = createSecretsReader({ cacheTtlMs: -1 });

      const first = await reader.get('expired-secret');
      const second = await reader.get('expired-secret');

      expect(first).toBe('first');
      expect(second).toBe('second');
      expect(send).toHaveBeenCalledTimes(2);
    });

    it('throws ApiError when SecretString is missing', async () => {
      send.mockResolvedValue({});
      const reader = createSecretsReader();

      await expect(reader.get('missing')).rejects.toBeInstanceOf(ApiError);
      await expect(reader.get('missing')).rejects.toMatchObject({
        statusCode: 503,
        details: [{ code: 'aws.unavailable' }],
      });
    });

    it('wraps non-ApiError throws as aws.unavailable', async () => {
      send.mockRejectedValue(new Error('network down'));
      const reader = createSecretsReader();

      await expect(reader.get('boom')).rejects.toMatchObject({
        statusCode: 503,
        code: 'service_unavailable',
        details: [{ code: 'aws.unavailable', meta: { dependency: 'Secrets Manager' } }],
      });
    });

    it('re-throws ApiError unchanged', async () => {
      const original = ApiError.internal('boom');
      send.mockRejectedValue(original);
      const reader = createSecretsReader();

      await expect(reader.get('x')).rejects.toBe(original);
    });
  });

  describe('getJson', () => {
    it('parses the secret as JSON', async () => {
      send.mockResolvedValue({ SecretString: '{"a":1,"b":2}' });
      const reader = createSecretsReader();

      const result = await reader.getJson<{ a: number; b: number }>('json-secret');
      expect(result).toEqual({ a: 1, b: 2 });
    });
  });

  describe('getRequiredString', () => {
    it('returns the value when present', async () => {
      send.mockResolvedValue({ SecretString: 'present' });
      const reader = createSecretsReader();
      expect(await reader.getRequiredString('p')).toBe('present');
    });

    it('surfaces aws.unavailable when the underlying SecretString is empty', async () => {
      send.mockResolvedValue({ SecretString: '' });
      const reader = createSecretsReader();
      await expect(reader.getRequiredString('p')).rejects.toMatchObject({
        statusCode: 503,
        details: [{ code: 'aws.unavailable' }],
      });
    });

    it('propagates aws.unavailable errors from the underlying get', async () => {
      send.mockRejectedValue(new Error('boom'));
      const reader = createSecretsReader();
      await expect(reader.getRequiredString('p')).rejects.toMatchObject({
        statusCode: 503,
        details: [{ code: 'aws.unavailable' }],
      });
    });
  });

  describe('clearCache', () => {
    it('drops a single secret entry and re-fetches it', async () => {
      send
        .mockResolvedValueOnce({ SecretString: 'v1' })
        .mockResolvedValueOnce({ SecretString: 'v2' });
      const reader = createSecretsReader();

      expect(await reader.get('s')).toBe('v1');
      reader.clearCache('s');
      expect(await reader.get('s')).toBe('v2');
      expect(send).toHaveBeenCalledTimes(2);
    });

    it('drops every entry when called without an id', async () => {
      send
        .mockResolvedValueOnce({ SecretString: 'a1' })
        .mockResolvedValueOnce({ SecretString: 'b1' })
        .mockResolvedValueOnce({ SecretString: 'a2' });
      const reader = createSecretsReader();

      expect(await reader.get('a')).toBe('a1');
      expect(await reader.get('b')).toBe('b1');
      reader.clearCache();
      expect(await reader.get('a')).toBe('a2');
      expect(send).toHaveBeenCalledTimes(3);
    });
  });
});
