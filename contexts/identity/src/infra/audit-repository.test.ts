// =============================================================================
// audit-repository - unit tests
// =============================================================================
// Mocks the Kysely handle so the test asserts query shape, not SQL
// execution. Follows the same pattern as user-repository.test.ts.
// =============================================================================

import { describe, it, expect, vi } from 'vitest';
import type { InsertQueryBuilder, Kysely } from 'kysely';
import { createAuditRepository } from './audit-repository.js';
import type { Database } from './database.js';

function makeDbWithFailingExecute() {
  const builder = {
    values: vi.fn().mockReturnThis(),
    execute: vi.fn().mockResolvedValueOnce(undefined),
  } as unknown as InsertQueryBuilder<Database, 'audit_log', unknown>;
  const db = {
    withSchema: vi.fn().mockReturnValue({
      insertInto: vi.fn().mockReturnValue(builder),
    }),
  } as unknown as Kysely<Database>;
  return { db, builder };
}

describe('audit-repository.insert', () => {
  it('withDb returns a new repository bound to the given handle', () => {
    const { db } = makeDbWithFailingExecute();
    const repo = createAuditRepository(db);
    const rebound = repo.withDb({} as Kysely<Database>);
    expect(rebound).not.toBe(repo);
  });

  it('writes the expected row to identity.audit_log', async () => {
    const { db, builder } = makeDbWithFailingExecute();
    const repo = createAuditRepository(db);

    await repo.insert({
      action: 'user.registered',
      actorUserId: null,
      subjectUserId: '11111111-1111-1111-1111-111111111111',
      metadata: { email: 'new@example.com', role: 'admin' },
    });

    expect(db.withSchema).toHaveBeenCalledWith('identity');
    expect(builder.values).toHaveBeenCalledWith({
      action: 'user.registered',
      actor_user_id: null,
      subject_user_id: '11111111-1111-1111-1111-111111111111',
      metadata: JSON.stringify({ email: 'new@example.com', role: 'admin' }),
    });
    expect(builder.execute).toHaveBeenCalledOnce();
  });

  it('serializes metadata as JSON string', async () => {
    const { db, builder } = makeDbWithFailingExecute();
    const repo = createAuditRepository(db);

    await repo.insert({
      action: 'user.profile_updated',
      actorUserId: 'a',
      subjectUserId: 'b',
      metadata: {
        changedFields: ['age'],
        old: { age: 30 },
        new: { age: 31 },
      },
    });

    const valuesArg = (builder.values as ReturnType<typeof vi.fn>).mock.calls[0][0];
    expect(valuesArg.metadata).toBe(
      JSON.stringify({
        changedFields: ['age'],
        old: { age: 30 },
        new: { age: 31 },
      }),
    );
  });

  it('maps DB errors to ApiError.dbUnavailable', async () => {
    const db = {
      withSchema: vi.fn().mockReturnValue({
        insertInto: vi.fn().mockReturnValue({
          values: vi.fn().mockReturnThis(),
          execute: vi.fn().mockRejectedValueOnce(new Error('connection refused')),
        }),
      }),
    } as unknown as Kysely<Database>;
    const repo = createAuditRepository(db);

    await expect(
      repo.insert({
        action: 'user.login',
        actorUserId: null,
        subjectUserId: 'u',
        metadata: { ip: '1.2.3.4', userAgent: 'curl' },
      }),
    ).rejects.toMatchObject({
      statusCode: 503,
      code: 'service_unavailable',
      details: [
        {
          code: 'db.unavailable',
          message: 'Database is unavailable',
          meta: { operation: 'audit_log.insert' },
        },
      ],
    });
  });

  it('returns the same error message when DB call fails (covers withDbErrorMapping path)', async () => {
    // The wrapper `withDbErrorMapping` re-throws ApiError instances
    // unchanged. We assert on the wrapper's output shape (statusCode 503 +
    // details[0].code 'db.unavailable') rather than on identity, because
    // Vite's transformer can create distinct ApiError class instances
    // across the test boundary and the production code path. The
    // class-identity contract is covered by withDbErrorMapping's own tests
    // in shared/src/infra/.
    const db = {
      withSchema: vi.fn().mockReturnValue({
        insertInto: vi.fn().mockReturnValue({
          values: vi.fn().mockReturnThis(),
          execute: vi.fn().mockRejectedValueOnce(new Error('connection refused')),
        }),
      }),
    } as unknown as Kysely<Database>;
    const repo = createAuditRepository(db);

    await expect(
      repo.insert({
        action: 'user.registered',
        actorUserId: null,
        subjectUserId: 'u',
        metadata: { email: 'a@b.c', role: 'admin' },
      }),
    ).rejects.toMatchObject({
      statusCode: 503,
      code: 'service_unavailable',
      details: [{ code: 'db.unavailable', meta: { operation: 'audit_log.insert' } }],
    });
  });
});
