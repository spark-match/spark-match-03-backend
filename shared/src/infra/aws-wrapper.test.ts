import { describe, it, expect } from 'vitest';
import { withAwsErrorMapping } from './aws-wrapper.js';
import { ApiError } from '../http/api-error.js';

describe('withAwsErrorMapping', () => {
  it('returns the value when the wrapped function resolves', async () => {
    const result = await withAwsErrorMapping('SSM', async () => 'arn:foo');
    expect(result).toBe('arn:foo');
  });

  it('maps generic Error to ApiError.awsUnavailable with dependency in meta', async () => {
    const cause = new Error('AccessDenied');
    await expect(
      withAwsErrorMapping('Secrets Manager', async () => {
        throw cause;
      }),
    ).rejects.toMatchObject({
      statusCode: 503,
      code: 'service_unavailable',
      cause,
      details: [
        {
          code: 'aws.unavailable',
          message: 'Secrets Manager is unavailable',
          meta: { dependency: 'Secrets Manager' },
        },
      ],
    });
  });

  it('re-throws ApiError unchanged', async () => {
    const original = ApiError.userNotFound();
    await expect(
      withAwsErrorMapping('SSM', async () => {
        throw original;
      }),
    ).rejects.toBe(original);
  });
});
