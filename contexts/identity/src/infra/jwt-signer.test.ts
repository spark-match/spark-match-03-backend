import { describe, it, expect, vi, beforeEach } from 'vitest';

const { mockGetRequiredString } = vi.hoisted(() => ({
  mockGetRequiredString: vi.fn(),
}));

vi.mock('@spark-match/shared/infra', async () => {
  const actual =
    await vi.importActual<typeof import('@spark-match/shared/infra')>('@spark-match/shared/infra');
  return {
    ...actual,
    createSecretsReader: vi.fn(),
    withAwsErrorMapping: vi.fn(async (_dep: string, fn: () => Promise<unknown>) => fn()),
  };
});

vi.mock('@aws-sdk/client-secrets-manager', () => {
  const send = vi.fn();
  const GetSecretValueCommand = vi.fn().mockImplementation((input: { SecretId: string }) => ({ input }));
  const SecretsManagerClient = vi.fn().mockImplementation(() => ({ send }));
  return { SecretsManagerClient, GetSecretValueCommand, send };
});

import { send } from '@aws-sdk/client-secrets-manager';
import { createJwtSigner } from './jwt-signer.js';

const mockedSend = vi.mocked(send);

beforeEach(() => {
  mockedSend.mockReset();
  mockedSend.mockResolvedValue({ SecretString: 'a'.repeat(64) });
});

describe('createJwtSigner', () => {
  it('mints a JWT after fetching the secret bytes from Secrets Manager', async () => {
    const signer = createJwtSigner({ secretArn: 'arn:aws:secretsmanager:us-east-1:111:secret:jwt-1' });

    const token = await signer.sign({
      subject: 'user-1',
      email: 'a@b.com',
      role: 'admin',
      expiresInSeconds: 60,
    });

    expect(typeof token).toBe('string');
    expect(token.split('.')).toHaveLength(3);
    expect(mockedSend).toHaveBeenCalledTimes(1);
  });

  it('caches the secret so repeat calls do not re-fetch', async () => {
    const signer = createJwtSigner({ secretArn: 'arn:aws:secretsmanager:us-east-1:111:secret:jwt-2' });

    await signer.sign({ subject: 'u', expiresInSeconds: 60 });
    await signer.sign({ subject: 'u', expiresInSeconds: 60 });
    await signer.sign({ subject: 'u', expiresInSeconds: 60 });

    expect(mockedSend).toHaveBeenCalledTimes(1);
  });

  it('dedupes concurrent in-flight fetches', async () => {
    let resolveSend: (v: unknown) => void = () => {};
    mockedSend.mockReset();
    mockedSend.mockImplementationOnce(
      () => new Promise((resolve) => {
        resolveSend = resolve;
      }),
    );

    const signer = createJwtSigner({ secretArn: 'arn:aws:secretsmanager:us-east-1:111:secret:jwt-3' });

    const first = signer.sign({ subject: 'u', expiresInSeconds: 60 });
    const second = signer.sign({ subject: 'u', expiresInSeconds: 60 });
    const third = signer.sign({ subject: 'u', expiresInSeconds: 60 });

    expect(mockedSend).toHaveBeenCalledTimes(1);

    resolveSend({ SecretString: 'b'.repeat(64) });

    await Promise.all([first, second, third]);
    expect(mockedSend).toHaveBeenCalledTimes(1);
  });

  it('clearCache is a no-op safe to call even when no secret has been fetched yet', () => {
    const signer = createJwtSigner({ secretArn: 'arn:aws:secretsmanager:us-east-1:111:secret:jwt-4' });
    expect(() => signer.clearCache()).not.toThrow();
  });

  it('throws when Secrets Manager returns a payload without SecretString', async () => {
    mockedSend.mockReset();
    mockedSend.mockResolvedValue({});

    const signer = createJwtSigner({ secretArn: 'arn:aws:secretsmanager:us-east-1:111:secret:jwt-5' });

    await expect(
      signer.sign({ subject: 'u', expiresInSeconds: 60 }),
    ).rejects.toBeDefined();
  });

  it('uses a provided cacheKey when supplied', async () => {
    const signer = createJwtSigner({
      secretArn: 'arn:primary',
      cacheKey: 'secondary-cache-key',
    });

    await signer.sign({ subject: 'u', expiresInSeconds: 60 });
    expect(mockedSend).toHaveBeenCalledTimes(1);
  });
});
