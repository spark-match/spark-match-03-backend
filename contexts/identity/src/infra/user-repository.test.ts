import { describe, it, expect, vi, beforeEach } from 'vitest';

type Chain = {
  withSchema: ReturnType<typeof vi.fn>;
  selectFrom: ReturnType<typeof vi.fn>;
  selectAll: ReturnType<typeof vi.fn>;
  select: ReturnType<typeof vi.fn>;
  where: ReturnType<typeof vi.fn>;
  executeTakeFirst: ReturnType<typeof vi.fn>;
  insertInto: ReturnType<typeof vi.fn>;
  values: ReturnType<typeof vi.fn>;
  returningAll: ReturnType<typeof vi.fn>;
  executeTakeFirstOrThrow: ReturnType<typeof vi.fn>;
};

function buildDb(terminal: unknown): Chain {
  const chain: Partial<Chain> = {};
  const finish = vi.fn().mockResolvedValue(terminal);
  chain.withSchema = vi.fn().mockReturnThis();
  chain.selectFrom = vi.fn().mockReturnThis();
  chain.insertInto = vi.fn().mockReturnThis();
  chain.selectAll = vi.fn().mockReturnThis();
  chain.select = vi.fn().mockReturnThis();
  chain.where = vi.fn().mockReturnThis();
  chain.values = vi.fn().mockReturnThis();
  chain.returningAll = vi.fn().mockReturnThis();
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
});
