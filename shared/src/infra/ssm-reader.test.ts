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

  it('returns undefined when SSM returns null', async () => {
    mockedGetParameter.mockResolvedValue(null);
    const reader = createSsmReader();
    expect(await reader.getString('null-param')).toBeUndefined();
  });

  it('returns the Value property when SSM returns an SSM-shaped object', async () => {
    mockedGetParameter.mockResolvedValue({ Value: 'object-value' });
    const reader = createSsmReader();
    expect(await reader.getString('obj-param')).toBe('object-value');
  });

  it('returns undefined when SSM returns an object without Value', async () => {
    mockedGetParameter.mockResolvedValue({ foo: 'bar' });
    const reader = createSsmReader();
    expect(await reader.getString('weird-param')).toBeUndefined();
  });

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
