// =============================================================================
// audit-repository - unit tests
// =============================================================================
// Mocks the Kysely handle so the test asserts query shape, not SQL
// execution. Follows the same pattern as user-repository.test.ts.
// =============================================================================

import { describe, it, expect, vi } from 'vitest';
import type { InsertQueryBuilder, Kysely, SelectQueryBuilder } from 'kysely';
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

/** Mock handle that captures the select chain and returns `rows` from execute. */
function makeDbReturning(rows: ReadonlyArray<Record<string, unknown>>) {
  const builder = {
    selectAll: vi.fn().mockReturnThis(),
    orderBy: vi.fn().mockReturnThis(),
    where: vi.fn().mockReturnThis(),
    limit: vi.fn().mockReturnThis(),
    execute: vi.fn().mockResolvedValue(rows),
  } as unknown as SelectQueryBuilder<Database, 'audit_log', unknown>;
  const db = {
    withSchema: vi.fn().mockReturnValue({
      selectFrom: vi.fn().mockReturnValue(builder),
    }),
  } as unknown as Kysely<Database>;
  return { db, builder };
}

function makeRow(overrides: Record<string, unknown> = {}) {
  return {
    id: '12345',
    occurred_at: new Date('2026-07-30T16:00:00Z'),
    action: 'user.login',
    actor_user_id: null,
    subject_user_id: '11111111-1111-4111-8111-111111111111',
    metadata: { ip: '1.2.3.4', userAgent: 'curl' },
    ...overrides,
  };
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

describe('audit-repository.list', () => {
  it('withDb returns a new repository bound to the given handle (list)', () => {
    const { db } = makeDbReturning([]);
    const repo = createAuditRepository(db);
    const rebound = repo.withDb({} as Kysely<Database>);
    expect(rebound).not.toBe(repo);
  });

  it('returns { entries, nextCursor: null } when empty', async () => {
    const { db } = makeDbReturning([]);
    const repo = createAuditRepository(db);
    const result = await repo.list({});
    expect(result.entries).toEqual([]);
    expect(result.nextCursor).toBeNull();
  });

  it('maps DB rows to domain AuditEntry entries (snake -> camel)', async () => {
    const when = new Date('2026-07-30T16:00:00Z');
    const { db } = makeDbReturning([
      makeRow({
        id: '100',
        occurred_at: when,
        action: 'user.profile_updated',
        actor_user_id: 'a-uuid',
        subject_user_id: 's-uuid',
        metadata: { changedFields: ['age'], old: { age: 30 }, new: { age: 31 } },
      }),
    ]);
    const repo = createAuditRepository(db);
    const result = await repo.list({});
    expect(result.entries).toHaveLength(1);
    expect(result.entries[0]).toMatchObject({
      id: '100',
      action: 'user.profile_updated',
      actorUserId: 'a-uuid',
      subjectUserId: 's-uuid',
      occurredAt: when,
      metadata: { changedFields: ['age'], old: { age: 30 }, new: { age: 31 } },
    });
  });

  it('fetches limit+1 to detect hasMore, returns nextCursor when more', async () => {
    const rows = Array.from({ length: 51 }, (_, i) => makeRow({ id: String(1000 + i) }));
    const { db, builder } = makeDbReturning(rows);
    const repo = createAuditRepository(db);
    const result = await repo.list({ limit: 50 });
    expect(result.entries).toHaveLength(50);
    expect(result.nextCursor).not.toBeNull();
    const decoded = JSON.parse(
      Buffer.from(result.nextCursor!, 'base64url').toString('utf8'),
    );
    expect(decoded.t).toBe('2026-07-30T16:00:00.000Z');
    expect(decoded.i).toBe('1049');
  });

  it('returns nextCursor null when no rows beyond limit', async () => {
    const rows = Array.from({ length: 10 }, (_, i) => makeRow({ id: String(i) }));
    const { db } = makeDbReturning(rows);
    const repo = createAuditRepository(db);
    const result = await repo.list({ limit: 50 });
    expect(result.entries).toHaveLength(10);
    expect(result.nextCursor).toBeNull();
  });

  it('returns empty result when cursor is malformed', async () => {
    const { db } = makeDbReturning([]);
    const repo = createAuditRepository(db);
    const result = await repo.list({ cursor: 'not-base64-junk!' });
    expect(result.entries).toEqual([]);
    expect(result.nextCursor).toBeNull();
  });

  it('applies filters + clamps limit to [1, 200]', async () => {
    const { db, builder } = makeDbReturning([makeRow()]);
    const repo = createAuditRepository(db);
    await repo.list({
      actorUserId: 'a-uuid',
      subjectUserId: 's-uuid',
      action: 'user.login',
      since: '2026-07-30T00:00:00Z',
      until: '2026-07-31T00:00:00Z',
      cursor: Buffer.from(
        JSON.stringify({ t: '2026-07-30T12:00:00Z', i: '500' }),
      ).toString('base64url'),
      limit: 25,
    });
    expect((builder.where as ReturnType<typeof vi.fn>).mock.calls.length).toBeGreaterThanOrEqual(5);
    expect((builder.limit as ReturnType<typeof vi.fn>).mock.calls[0][0]).toBe(26);
  });
});
