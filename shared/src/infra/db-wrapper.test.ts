import { describe, it, expect } from 'vitest';
import { withDbErrorMapping } from './db-wrapper.js';
import { ApiError } from '../http/api-error.js';

describe('withDbErrorMapping', () => {
  it('returns the value when the wrapped function resolves', async () => {
    const result = await withDbErrorMapping('test.op', async () => 42);
    expect(result).toBe(42);
  });

  it('maps generic Error to ApiError.dbUnavailable with the operation in meta', async () => {
    const cause = new Error('connection refused');
    await expect(
      withDbErrorMapping('users.findById', async () => {
        throw cause;
      }),
    ).rejects.toMatchObject({
      statusCode: 503,
      code: 'service_unavailable',
      cause,
      details: [
        {
          code: 'db.unavailable',
          message: 'Database is unavailable',
          meta: { operation: 'users.findById' },
        },
      ],
    });
  });

  it('maps non-Error throws to ApiError.dbUnavailable', async () => {
    await expect(
      withDbErrorMapping('users.list', async () => {
        throw 'string-throw';
      }),
    ).rejects.toBeInstanceOf(ApiError);
  });

  it('re-throws already-typed ApiError unchanged', async () => {
    const original = ApiError.userNotFound();
    await expect(
      withDbErrorMapping('users.findById', async () => {
        throw original;
      }),
    ).rejects.toBe(original);
  });

  it('re-throws ApiError.conflict unchanged (lets business errors propagate)', async () => {
    const conflict = ApiError.emailTaken('a@b.com');
    await expect(
      withDbErrorMapping('users.create', async () => {
        throw conflict;
      }),
    ).rejects.toBe(conflict);
  });

  it('returns Promise<void> for void operations', async () => {
    let invoked = false;
    await withDbErrorMapping('users.updatePassword', async () => {
      invoked = true;
    });
    expect(invoked).toBe(true);
  });
});
