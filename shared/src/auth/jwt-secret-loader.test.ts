import { describe, it, expect, vi, beforeEach } from 'vitest';

const mockSsmGetRequiredString = vi.fn();
const mockSecretsGetRequiredString = vi.fn();

vi.mock('../infra/ssm-reader.js', () => ({
  createSsmReader: () => ({
    getString: mockSsmGetRequiredString,
    getRequiredString: mockSsmGetRequiredString,
    invalidate: vi.fn(),
  }),
}));

vi.mock('../infra/secrets-reader.js', () => ({
  createSecretsReader: () => ({
    getString: mockSecretsGetRequiredString,
    getRequiredString: mockSecretsGetRequiredString,
    getJson: mockSecretsGetRequiredString,
    clearCache: vi.fn(),
  }),
}));

import { loadJwtSecret, _resetJwtSecretCache } from './jwt-secret-loader.js';

const SECRET_VALUE = 'a'.repeat(64);

beforeEach(() => {
  mockSsmGetRequiredString.mockReset();
  mockSecretsGetRequiredString.mockReset();
  _resetJwtSecretCache();
  mockSsmGetRequiredString.mockResolvedValue('arn:jwt');
  mockSecretsGetRequiredString.mockResolvedValue(SECRET_VALUE);
});

describe('loadJwtSecret (cache miss + hit)', () => {
  it('loads the secret from SSM + Secrets Manager on first call', async () => {
    const secret = await loadJwtSecret();
    expect(secret).toEqual(new TextEncoder().encode(SECRET_VALUE));
    expect(mockSsmGetRequiredString).toHaveBeenCalledTimes(1);
    expect(mockSecretsGetRequiredString).toHaveBeenCalledTimes(1);
  });

  it('returns the cached secret on subsequent calls (no re-fetch)', async () => {
    await loadJwtSecret();
    await loadJwtSecret();
    await loadJwtSecret();

    expect(mockSsmGetRequiredString).toHaveBeenCalledTimes(1);
    expect(mockSecretsGetRequiredString).toHaveBeenCalledTimes(1);
  });

  it('clears the cache when _resetJwtSecretCache is called', async () => {
    await loadJwtSecret();
    _resetJwtSecretCache();
    await loadJwtSecret();

    expect(mockSsmGetRequiredString).toHaveBeenCalledTimes(2);
    expect(mockSecretsGetRequiredString).toHaveBeenCalledTimes(2);
  });
});

describe('loadJwtSecret (in-flight dedupe)', () => {
  it('dedupes concurrent calls so only one fetch runs', async () => {
    let resolveSsm: (value: string) => void = () => {};
    mockSsmGetRequiredString.mockImplementation(
      () => new Promise<string>((resolve) => {
        resolveSsm = resolve;
      }),
    );

    const a = loadJwtSecret();
    const b = loadJwtSecret();
    const c = loadJwtSecret();

    expect(mockSsmGetRequiredString).toHaveBeenCalledTimes(1);

    resolveSsm('arn:jwt');
    mockSecretsGetRequiredString.mockResolvedValue(SECRET_VALUE);

    const [sa, sb, sc] = await Promise.all([a, b, c]);
    expect(sa).toEqual(sb);
    expect(sb).toEqual(sc);
    expect(mockSsmGetRequiredString).toHaveBeenCalledTimes(1);
    expect(mockSecretsGetRequiredString).toHaveBeenCalledTimes(1);
  });
});