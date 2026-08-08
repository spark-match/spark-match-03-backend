import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('@aws-lambda-powertools/parameters/ssm', () => ({
  getParameter: vi.fn(),
}));

import { getParameter } from '@aws-lambda-powertools/parameters/ssm';
import { createSsmReader } from './ssm-reader.js';
import { ApiError } from '../http/api-error.js';

const mockedGetParameter = vi.mocked(getParameter);

beforeEach(() => {
  mockedGetParameter.mockReset();
});

describe('createSsmReader.getString', () => {
  it('returns string value as-is when SSM returns a string', async () => {
    mockedGetParameter.mockResolvedValue('plain-value');
    const reader = createSsmReader();
    const result = await reader.getString('any-name');
    expect(result).toBe('plain-value');
    expect(mockedGetParameter).toHaveBeenCalledWith('any-name', {
      maxAge: 300,
      throwOnError: false,
    });
  });

  it('returns undefined when SSM returns undefined', async () => {
    mockedGetParameter.mockResolvedValue(undefined);
    const reader = createSsmReader();
    expect(await reader.getString('missing')).toBeUndefined();
  });

  // Note: as of @aws-lambda-powertools/parameters 2.34.0, getParameter normalizes
  // the SSM SDK response and always returns `string | undefined`. The wrapper
  // `{ Value: string }` shape and arbitrary `null` returns that existed in
  // 2.33.x are no longer possible — the library handles them internally.
  // We therefore only test the supported outputs (string and undefined).

  it('uses the provided maxAge when supplied', async () => {
    mockedGetParameter.mockResolvedValue('x');
    const reader = createSsmReader();
    await reader.getString('name', 60);
    expect(mockedGetParameter).toHaveBeenCalledWith('name', {
      maxAge: 60,
      throwOnError: false,
    });
  });

  it('uses the reader default maxAge when not supplied', async () => {
    mockedGetParameter.mockResolvedValue('x');
    const reader = createSsmReader(120);
    await reader.getString('name');
    expect(mockedGetParameter).toHaveBeenCalledWith('name', {
      maxAge: 120,
      throwOnError: false,
    });
  });

  it('wraps non-ApiError throw into ApiError.awsUnavailable', async () => {
    const boom = new Error('network down');
    mockedGetParameter.mockRejectedValue(boom);
    const reader = createSsmReader();

    await expect(reader.getString('name')).rejects.toBeInstanceOf(ApiError);
    await expect(reader.getString('name')).rejects.toMatchObject({
      statusCode: 503,
      code: 'service_unavailable',
      details: [
        {
          code: 'aws.unavailable',
          meta: { dependency: 'SSM' },
        },
      ],
    });
  });

  it('re-throws ApiError instances unchanged', async () => {
    const original = ApiError.internal('boom');
    mockedGetParameter.mockRejectedValue(original);
    const reader = createSsmReader();

    await expect(reader.getString('name')).rejects.toBe(original);
  });
});

describe('createSsmReader.getRequiredString', () => {
  it('returns the value when present', async () => {
    mockedGetParameter.mockResolvedValue('present');
    const reader = createSsmReader();
    expect(await reader.getRequiredString('p')).toBe('present');
  });

  it('throws ApiError.internal when the value is missing', async () => {
    mockedGetParameter.mockResolvedValue(undefined);
    const reader = createSsmReader();

    await expect(reader.getRequiredString('p')).rejects.toMatchObject({
      statusCode: 500,
      message: 'Required SSM parameter not found or empty: p',
    });
  });

  it('propagates dependency errors from getString', async () => {
    mockedGetParameter.mockRejectedValue(new Error('boom'));
    const reader = createSsmReader();

    await expect(reader.getRequiredString('p')).rejects.toMatchObject({
      code: 'service_unavailable',
      details: [{ code: 'aws.unavailable' }],
    });
  });
});

describe('createSsmReader.getRequiredSecureString', () => {
  it('passes decrypt: true so SSM returns the plaintext, not the ciphertext', async () => {
    mockedGetParameter.mockResolvedValue('postgres://user:pass@host:5432/db');
    const reader = createSsmReader();

    expect(await reader.getRequiredSecureString('/spark-match/dev/config/db-connection-url')).toBe(
      'postgres://user:pass@host:5432/db',
    );
    expect(mockedGetParameter).toHaveBeenCalledWith('/spark-match/dev/config/db-connection-url', {
      maxAge: 300,
      decrypt: true,
      throwOnError: false,
    });
  });

  it('uses the provided maxAge when supplied', async () => {
    mockedGetParameter.mockResolvedValue('x');
    const reader = createSsmReader();
    await reader.getRequiredSecureString('name', 60);
    expect(mockedGetParameter).toHaveBeenCalledWith('name', {
      maxAge: 60,
      decrypt: true,
      throwOnError: false,
    });
  });

  it('uses the reader default maxAge when not supplied', async () => {
    mockedGetParameter.mockResolvedValue('x');
    const reader = createSsmReader(120);
    await reader.getRequiredSecureString('name');
    expect(mockedGetParameter).toHaveBeenCalledWith('name', {
      maxAge: 120,
      decrypt: true,
      throwOnError: false,
    });
  });

  it('throws ApiError.internal when the value is missing', async () => {
    mockedGetParameter.mockResolvedValue(undefined);
    const reader = createSsmReader();

    await expect(reader.getRequiredSecureString('p')).rejects.toMatchObject({
      statusCode: 500,
      message: 'Required SSM parameter not found or empty: p',
    });
  });

  it('wraps non-ApiError throw into ApiError.awsUnavailable', async () => {
    mockedGetParameter.mockRejectedValue(new Error('kms denied'));
    const reader = createSsmReader();

    await expect(reader.getRequiredSecureString('p')).rejects.toMatchObject({
      statusCode: 503,
      code: 'service_unavailable',
      details: [
        {
          code: 'aws.unavailable',
          meta: { dependency: 'SSM' },
        },
      ],
    });
  });

  it('re-throws ApiError instances unchanged', async () => {
    const original = ApiError.internal('boom');
    mockedGetParameter.mockRejectedValue(original);
    const reader = createSsmReader();

    await expect(reader.getRequiredSecureString('p')).rejects.toBe(original);
  });
});

describe('createSsmReader.invalidate', () => {
  it('fetches with forceFetch when a name is provided', () => {
    mockedGetParameter.mockResolvedValue('x');
    const reader = createSsmReader();
    reader.invalidate('my-param');
    expect(mockedGetParameter).toHaveBeenCalledWith('my-param', { forceFetch: true });
  });

  it('does not call getParameter when no name is provided', () => {
    const reader = createSsmReader();
    reader.invalidate();
    expect(mockedGetParameter).not.toHaveBeenCalled();
  });

  it('swallows errors from the underlying getParameter', async () => {
    mockedGetParameter.mockRejectedValue(new Error('boom'));
    const reader = createSsmReader();

    expect(() => reader.invalidate('my-param')).not.toThrow();

    await new Promise((resolve) => setImmediate(resolve));
    expect(mockedGetParameter).toHaveBeenCalled();
  });
});
