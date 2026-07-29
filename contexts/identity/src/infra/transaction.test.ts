// =============================================================================
// withTransaction - unit tests
// =============================================================================
// Mocks the kysely handle so the test asserts the transaction API shape
// and the isolation level, not SQL execution. Follows the same pattern as
// audit-repository.test.ts.
// =============================================================================

import { describe, it, expect, vi } from 'vitest';
import type { Kysely } from 'kysely';
import { withTransaction } from './transaction.js';
import type { Database } from './database.js';

describe('withTransaction', () => {
  it('starts a transaction, sets READ COMMITTED, runs the callback', async () => {
    const setIsolationLevel = vi.fn().mockReturnThis();
    const execute = vi.fn().mockResolvedValueOnce('callback-result');
    const transaction = vi.fn().mockReturnValue({
      setIsolationLevel,
      execute,
    });
    const db = { transaction } as unknown as Kysely<Database>;

    const result = await withTransaction(db, async () => 'callback-result');

    expect(transaction).toHaveBeenCalledOnce();
    expect(setIsolationLevel).toHaveBeenCalledWith('read committed');
    expect(execute).toHaveBeenCalledOnce();
    expect(result).toBe('callback-result');
  });

  it('passes the transaction handle to the callback', async () => {
    const txHandle = { id: 'tx-handle' };
    const execute = vi.fn().mockImplementation((fn) => fn(txHandle));
    const transaction = vi.fn().mockReturnValue({
      setIsolationLevel: vi.fn().mockReturnThis(),
      execute,
    });
    const db = { transaction } as unknown as Kysely<Database>;

    let captured: unknown = null;
    await withTransaction(db, async (tx) => {
      captured = tx;
    });

    expect(captured).toBe(txHandle);
  });

  it('propagates errors thrown by the callback (Kysely rolls back)', async () => {
    const error = new Error('rollback');
    const execute = vi.fn().mockImplementation(() => {
      throw error;
    });
    const transaction = vi.fn().mockReturnValue({
      setIsolationLevel: vi.fn().mockReturnThis(),
      execute,
    });
    const db = { transaction } as unknown as Kysely<Database>;

    await expect(
      withTransaction(db, async () => {
        throw error;
      }),
    ).rejects.toBe(error);
  });
});
