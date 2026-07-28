import { describe, it, expect, vi, beforeEach } from 'vitest';

type Chain = {
  withSchema: ReturnType<typeof vi.fn>;
  selectFrom: ReturnType<typeof vi.fn>;
  selectAll: ReturnType<typeof vi.fn>;
  select: ReturnType<typeof vi.fn>;
  where: ReturnType<typeof vi.fn>;
  orderBy: ReturnType<typeof vi.fn>;
  limit: ReturnType<typeof vi.fn>;
  execute: ReturnType<typeof vi.fn>;
  executeTakeFirst: ReturnType<typeof vi.fn>;
  insertInto: ReturnType<typeof vi.fn>;
  values: ReturnType<typeof vi.fn>;
  updateTable: ReturnType<typeof vi.fn>;
  set: ReturnType<typeof vi.fn>;
  returningAll: ReturnType<typeof vi.fn>;
  executeTakeFirstOrThrow: ReturnType<typeof vi.fn>;
};

function buildDb(terminal: unknown): Chain {
  const chain: Partial<Chain> = {};
  const finish = vi.fn().mockResolvedValue(terminal);
  chain.withSchema = vi.fn().mockReturnThis();
  chain.selectFrom = vi.fn().mockReturnThis();
  chain.insertInto = vi.fn().mockReturnThis();
  chain.updateTable = vi.fn().mockReturnThis();
  chain.selectAll = vi.fn().mockReturnThis();
  chain.select = vi.fn().mockReturnThis();
  chain.where = vi.fn().mockReturnThis();
  chain.orderBy = vi.fn().mockReturnThis();
  chain.limit = vi.fn().mockReturnThis();
  chain.values = vi.fn().mockReturnThis();
  chain.set = vi.fn().mockReturnThis();
  chain.returningAll = vi.fn().mockReturnThis();
  chain.execute = finish;
  chain.executeTakeFirst = finish;
  chain.executeTakeFirstOrThrow = finish;
  return chain as Chain;
}

import { createUserRepository } from './user-repository.js';

const rowFixture = {
  id: '3a8e6c4e-1f3a-4f0e-9a3d-1c2b3a4d5e6f',
  email: 'a@b.com',
  full_name: 'Ada',
  password_hash: 'scrypt$1$2$3$hash',
  age: 36,
  role: 'admin' as const,
  active: true,
  created_at: new Date('2026-01-01T00:00:00.000Z'),
  updated_at: new Date('2026-01-01T00:00:00.000Z'),
};

beforeEach(() => {
  vi.restoreAllMocks();
});

describe('createUserRepository', () => {
  describe('findByEmail', () => {
    it('returns the mapped user when the row exists', async () => {
      const chain = buildDb(rowFixture);
      const repo = createUserRepository(chain as never);

      const user = await repo.findByEmail('a@b.com');

      expect(user).toEqual({
        id: rowFixture.id,
        email: 'a@b.com',
        fullName: 'Ada',
        passwordHash: 'scrypt$1$2$3$hash',
        age: 36,
        role: 'admin',
        active: true,
        createdAt: rowFixture.created_at,
        updatedAt: rowFixture.updated_at,
      });
      expect(chain.selectFrom).toHaveBeenCalledWith('users');
      expect(chain.where).toHaveBeenCalledWith('email', '=', 'a@b.com');
    });

    it('returns null when the row is missing', async () => {
      const chain = buildDb(undefined);
      const repo = createUserRepository(chain as never);

      expect(await repo.findByEmail('missing@b.com')).toBeNull();
    });
  });

  describe('findById', () => {
    it('returns the mapped user when the row exists', async () => {
      const chain = buildDb(rowFixture);
      const repo = createUserRepository(chain as never);

      const user = await repo.findById(rowFixture.id);

      expect(user?.id).toBe(rowFixture.id);
      expect(chain.where).toHaveBeenCalledWith('id', '=', rowFixture.id);
    });

    it('returns null when the row is missing', async () => {
      const chain = buildDb(undefined);
      const repo = createUserRepository(chain as never);

      expect(await repo.findById('missing')).toBeNull();
    });
  });

  describe('create', () => {
    it('inserts a new row and returns the mapped user', async () => {
      const chain = buildDb(rowFixture);
      const repo = createUserRepository(chain as never);

      const user = await repo.create({
        email: 'a@b.com',
        passwordHash: 'scrypt$1$2$3$hash',
        fullName: 'Ada',
        age: 36,
      });

      expect(user.id).toBe(rowFixture.id);
      expect(chain.insertInto).toHaveBeenCalledWith('users');
      const inserted = chain.values.mock.calls[0]![0] as Record<string, unknown>;
      expect(inserted.email).toBe('a@b.com');
      expect(inserted.full_name).toBe('Ada');
      expect(inserted.password_hash).toBe('scrypt$1$2$3$hash');
      expect(inserted.age).toBe(36);
      expect(typeof inserted.id).toBe('string');
      expect(inserted.created_at).toBeInstanceOf(Date);
    });

    it('stores age as null when omitted', async () => {
      const chain = buildDb(rowFixture);
      const repo = createUserRepository(chain as never);

      await repo.create({
        email: 'a@b.com',
        passwordHash: 'hash',
        fullName: 'Ada',
      });

      const inserted = chain.values.mock.calls[0]![0] as Record<string, unknown>;
      expect(inserted.age).toBeNull();
    });

    it('throws when the insert returns no row', async () => {
      const chain = buildDb(null);
      chain.executeTakeFirstOrThrow = vi.fn().mockRejectedValue(new Error('insert failed'));
      const repo = createUserRepository(chain as never);

      // withDbErrorMapping wraps any thrown error as ApiError.dbUnavailable
      // (code: db.unavailable, meta.operation: users.create). The original
      // 'insert failed' message is preserved on `cause`.
      await expect(
        repo.create({ email: 'a@b.com', passwordHash: 'h', fullName: 'Ada' }),
      ).rejects.toMatchObject({
        statusCode: 503,
        code: 'service_unavailable',
        details: expect.arrayContaining([
          expect.objectContaining({ code: 'db.unavailable' }),
        ]),
        cause: expect.objectContaining({ message: 'insert failed' }),
      });
    });
  });

  describe('existsByEmail', () => {
    it('returns true when the row exists', async () => {
      const chain = buildDb({ id: rowFixture.id });
      const repo = createUserRepository(chain as never);

      expect(await repo.existsByEmail('a@b.com')).toBe(true);
    });

    it('returns false when the row is missing', async () => {
      const chain = buildDb(undefined);
      const repo = createUserRepository(chain as never);

      expect(await repo.existsByEmail('missing@b.com')).toBe(false);
    });
  });

  describe('updatePassword', () => {
    it('updates the password_hash column and returns the mapped user', async () => {
      const chain = buildDb(rowFixture);
      const repo = createUserRepository(chain as never);

      const user = await repo.updatePassword(rowFixture.id, 'new-hash');

      expect(user.id).toBe(rowFixture.id);
      expect(chain.updateTable).toHaveBeenCalledWith('users');
      const setCall = chain.set.mock.calls[0]![0] as Record<string, unknown>;
      expect(setCall.password_hash).toBe('new-hash');
      expect(setCall.updated_at).toBeInstanceOf(Date);
    });

    it('wraps a DB error as ApiError.dbUnavailable (users.updatePassword)', async () => {
      const chain = buildDb(null);
      chain.executeTakeFirstOrThrow = vi.fn().mockRejectedValue(new Error('boom'));
      const repo = createUserRepository(chain as never);

      await expect(repo.updatePassword(rowFixture.id, 'h')).rejects.toMatchObject({
        statusCode: 503,
        code: 'service_unavailable',
        details: expect.arrayContaining([
          expect.objectContaining({ code: 'db.unavailable', meta: expect.objectContaining({ operation: 'users.updatePassword' }) }),
        ]),
      });
    });
  });

  describe('update', () => {
    it('patches fullName and age when both are provided', async () => {
      const chain = buildDb(rowFixture);
      const repo = createUserRepository(chain as never);

      const user = await repo.update(rowFixture.id, { fullName: 'New Name', age: 50 });

      expect(user.id).toBe(rowFixture.id);
      const setCall = chain.set.mock.calls[0]![0] as Record<string, unknown>;
      expect(setCall.full_name).toBe('New Name');
      expect(setCall.age).toBe(50);
      expect(setCall.updated_at).toBeInstanceOf(Date);
    });

    it('only patches fullName when age is omitted', async () => {
      const chain = buildDb(rowFixture);
      const repo = createUserRepository(chain as never);

      await repo.update(rowFixture.id, { fullName: 'Only Name' });

      const setCall = chain.set.mock.calls[0]![0] as Record<string, unknown>;
      expect(setCall.full_name).toBe('Only Name');
      expect(setCall.age).toBeUndefined();
    });

    it('only patches age (including null) when fullName is omitted', async () => {
      const chain = buildDb(rowFixture);
      const repo = createUserRepository(chain as never);

      await repo.update(rowFixture.id, { age: null });

      const setCall = chain.set.mock.calls[0]![0] as Record<string, unknown>;
      expect(setCall.age).toBeNull();
      expect(setCall.full_name).toBeUndefined();
    });

    it('wraps a DB error as ApiError.dbUnavailable (users.update)', async () => {
      const chain = buildDb(null);
      chain.executeTakeFirstOrThrow = vi.fn().mockRejectedValue(new Error('boom'));
      const repo = createUserRepository(chain as never);

      await expect(repo.update(rowFixture.id, { fullName: 'X' })).rejects.toMatchObject({
        statusCode: 503,
        code: 'service_unavailable',
        details: expect.arrayContaining([
          expect.objectContaining({ code: 'db.unavailable', meta: expect.objectContaining({ operation: 'users.update' }) }),
        ]),
      });
    });
  });

  describe('setActive', () => {
    it('sets active=true and returns the mapped user', async () => {
      const chain = buildDb(rowFixture);
      const repo = createUserRepository(chain as never);

      const user = await repo.setActive(rowFixture.id, true);

      expect(user.id).toBe(rowFixture.id);
      const setCall = chain.set.mock.calls[0]![0] as Record<string, unknown>;
      expect(setCall.active).toBe(true);
      expect(setCall.updated_at).toBeInstanceOf(Date);
    });

    it('sets active=false (deactivation path)', async () => {
      const chain = buildDb({ ...rowFixture, active: false });
      const repo = createUserRepository(chain as never);

      const user = await repo.setActive(rowFixture.id, false);

      expect(user.active).toBe(false);
      const setCall = chain.set.mock.calls[0]![0] as Record<string, unknown>;
      expect(setCall.active).toBe(false);
    });
  });

  describe('setRole', () => {
    it('updates the role column and returns the mapped user', async () => {
      const chain = buildDb(rowFixture);
      const repo = createUserRepository(chain as never);

      const user = await repo.setRole(rowFixture.id, 'admin');

      expect(user.id).toBe(rowFixture.id);
      const setCall = chain.set.mock.calls[0]![0] as Record<string, unknown>;
      expect(setCall.role).toBe('admin');
      expect(setCall.updated_at).toBeInstanceOf(Date);
    });
  });

  describe('list', () => {
    it('returns the rows when fewer than limit+1 are present (no nextCursor)', async () => {
      const rows = [rowFixture, { ...rowFixture, id: 'b', email: 'b@b.com' }];
      const chain = buildDb(rows);
      const repo = createUserRepository(chain as never);

      const result = await repo.list({ limit: 5 });

      expect(result.users).toHaveLength(2);
      expect(result.nextCursor).toBeNull();
      expect(chain.orderBy).toHaveBeenCalledWith('created_at', 'asc');
      expect(chain.limit).toHaveBeenCalledWith(6); // limit + 1
    });

    it('trims to limit and exposes nextCursor when more rows exist', async () => {
      const rows = [
        rowFixture,
        { ...rowFixture, id: 'b', email: 'b@b.com' },
        { ...rowFixture, id: 'c', email: 'c@c.com' },
      ];
      const chain = buildDb(rows);
      const repo = createUserRepository(chain as never);

      const result = await repo.list({ limit: 2 });

      expect(result.users).toHaveLength(2);
      expect(result.nextCursor).toBe('b');
    });

    it('applies emailContains filter (ilike)', async () => {
      const chain = buildDb([rowFixture]);
      const repo = createUserRepository(chain as never);

      await repo.list({ limit: 5, emailContains: 'ada' });

      expect(chain.where).toHaveBeenCalledWith('email', 'ilike', '%ada%');
    });

    it('applies cursor filter (id > cursor)', async () => {
      const chain = buildDb([rowFixture]);
      const repo = createUserRepository(chain as never);

      await repo.list({ limit: 5, cursor: 'abc' });

      expect(chain.where).toHaveBeenCalledWith('id', '>', 'abc');
    });

    it('wraps a DB error as ApiError.dbUnavailable (users.list)', async () => {
      const chain = buildDb(null);
      chain.execute = vi.fn().mockRejectedValue(new Error('boom'));
      const repo = createUserRepository(chain as never);

      await expect(repo.list({ limit: 5 })).rejects.toMatchObject({
        statusCode: 503,
        code: 'service_unavailable',
        details: expect.arrayContaining([
          expect.objectContaining({ code: 'db.unavailable', meta: expect.objectContaining({ operation: 'users.list' }) }),
        ]),
      });
    });
  });

  describe('count', () => {
    it('returns the parsed number when pg returns a string total', async () => {
      const chain = buildDb({ total: '42' });
      const repo = createUserRepository(chain as never);

      const result = await repo.count();

      expect(result).toBe(42);
      expect(typeof result).toBe('number');
    });

    it('returns the number directly when pg returns a number total', async () => {
      const chain = buildDb({ total: 7 });
      const repo = createUserRepository(chain as never);

      const result = await repo.count();

      expect(result).toBe(7);
    });

    it('wraps a DB error as ApiError.dbUnavailable (users.count)', async () => {
      const chain = buildDb(null);
      chain.executeTakeFirstOrThrow = vi.fn().mockRejectedValue(new Error('boom'));
      const repo = createUserRepository(chain as never);

      await expect(repo.count()).rejects.toMatchObject({
        statusCode: 503,
        code: 'service_unavailable',
        details: expect.arrayContaining([
          expect.objectContaining({ code: 'db.unavailable', meta: expect.objectContaining({ operation: 'users.count' }) }),
        ]),
      });
    });
  });
});
