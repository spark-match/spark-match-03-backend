// =============================================================================
// User repository - kysely queries against identity.users
// =============================================================================
// All DB calls are wrapped with withDbErrorMapping so any thrown error is
// surfaced as ApiError.dbUnavailable (code: db.unavailable, meta.operation).
// Already-typed ApiErrors from the service layer propagate unchanged.
//
// Kysely does NOT allow schema-qualified table names in `selectFrom()` to
// match the `Database` interface (it would type as `never`). We use the
// `withSchema()` modifier on the query builder instead, which keeps the
// type-level link to the `Database['users']` row type.
// =============================================================================

import type { Kysely, Transaction } from 'kysely';
import { withDbErrorMapping } from '@spark-match/shared/infra';
import type { User, CreateUserInput, UserRole, UpdateUserInput } from '../domain/user.js';
import { SELF_REGISTRATION_ROLE } from '../domain/user.js';
import type { Database } from './database.js';

export type { Database } from './database.js';

const IDENTITY = 'identity';

/**
 * The role a newly created user gets. Was 'admin' until 2026-08-08, which made
 * every visitor who registered an administrator -- see migration 005 for the
 * full account.
 *
 * It reads from the domain constant rather than repeating the literal, so the
 * value cannot drift from `USER_ROLES` or from the CHECK constraint.
 */
const DEFAULT_ROLE: UserRole = SELF_REGISTRATION_ROLE;

export interface ListUsersFilters {
  limit: number;
  cursor?: string;
  emailContains?: string;
}

export interface ListUsersResult {
  users: User[];
  nextCursor: string | null;
}

export interface UserRepository {
  withDb(db: Kysely<Database> | Transaction<Database>): UserRepository;
  findByEmail(email: string): Promise<User | null>;
  findById(id: string): Promise<User | null>;
  create(input: CreateUserInput): Promise<User>;
  existsByEmail(email: string): Promise<boolean>;
  updatePassword(id: string, passwordHash: string): Promise<User>;
  update(id: string, changes: UpdateUserInput): Promise<User>;
  setActive(id: string, active: boolean): Promise<User>;
  setRole(id: string, role: UserRole): Promise<User>;
  list(filters: ListUsersFilters): Promise<ListUsersResult>;
  count(): Promise<number>;
}

export function createUserRepository(db: Kysely<Database> | Transaction<Database>): UserRepository {
  return {
    withDb(newDb: Kysely<Database> | Transaction<Database>): UserRepository {
      return createUserRepository(newDb);
    },
    async findByEmail(email: string): Promise<User | null> {
      return withDbErrorMapping('users.findByEmail', async () => {
        const row = await db
          .withSchema(IDENTITY)
          .selectFrom('users')
          .selectAll()
          .where('email', '=', email)
          .executeTakeFirst();
        return row ? mapRowToUser(row) : null;
      });
    },

    async findById(id: string): Promise<User | null> {
      return withDbErrorMapping('users.findById', async () => {
        const row = await db
          .withSchema(IDENTITY)
          .selectFrom('users')
          .selectAll()
          .where('id', '=', id)
          .executeTakeFirst();
        return row ? mapRowToUser(row) : null;
      });
    },

    async create(input: CreateUserInput): Promise<User> {
      return withDbErrorMapping('users.create', async () => {
        const id = crypto.randomUUID();
        const now = new Date();
        const row = await db
          .withSchema(IDENTITY)
          .insertInto('users')
          .values({
            id,
            email: input.email,
            full_name: input.fullName,
            password_hash: input.passwordHash,
            age: input.age ?? null,
            role: DEFAULT_ROLE,
            active: true,
            created_at: now,
            updated_at: now,
          })
          .returningAll()
          .executeTakeFirstOrThrow();
        return mapRowToUser(row);
      });
    },

    async existsByEmail(email: string): Promise<boolean> {
      return withDbErrorMapping('users.existsByEmail', async () => {
        const row = await db
          .withSchema(IDENTITY)
          .selectFrom('users')
          .select('id')
          .where('email', '=', email)
          .executeTakeFirst();
        return row !== undefined;
      });
    },

    async updatePassword(id: string, passwordHash: string): Promise<User> {
      return withDbErrorMapping('users.updatePassword', async () => {
        const row = await db
          .withSchema(IDENTITY)
          .updateTable('users')
          .set({ password_hash: passwordHash, updated_at: new Date() })
          .where('id', '=', id)
          .returningAll()
          .executeTakeFirstOrThrow();
        return mapRowToUser(row);
      });
    },

    async update(id: string, changes: UpdateUserInput): Promise<User> {
      return withDbErrorMapping('users.update', async () => {
        const patch: Partial<Database['users']> = { updated_at: new Date() };
        if (changes.fullName !== undefined) patch.full_name = changes.fullName;
        if (changes.age !== undefined) patch.age = changes.age;
        const row = await db
          .withSchema(IDENTITY)
          .updateTable('users')
          .set(patch)
          .where('id', '=', id)
          .returningAll()
          .executeTakeFirstOrThrow();
        return mapRowToUser(row);
      });
    },

    async setActive(id: string, active: boolean): Promise<User> {
      return withDbErrorMapping('users.setActive', async () => {
        const row = await db
          .withSchema(IDENTITY)
          .updateTable('users')
          .set({ active, updated_at: new Date() })
          .where('id', '=', id)
          .returningAll()
          .executeTakeFirstOrThrow();
        return mapRowToUser(row);
      });
    },

    async setRole(id: string, role: UserRole): Promise<User> {
      return withDbErrorMapping('users.setRole', async () => {
        const row = await db
          .withSchema(IDENTITY)
          .updateTable('users')
          .set({ role, updated_at: new Date() })
          .where('id', '=', id)
          .returningAll()
          .executeTakeFirstOrThrow();
        return mapRowToUser(row);
      });
    },

    async list(filters: ListUsersFilters): Promise<ListUsersResult> {
      return withDbErrorMapping('users.list', async () => {
        let query = db
          .withSchema(IDENTITY)
          .selectFrom('users')
          .selectAll()
          .orderBy('created_at', 'asc')
          .limit(filters.limit + 1);

        if (filters.emailContains) {
          query = query.where('email', 'ilike', `%${filters.emailContains}%`);
        }
        if (filters.cursor) {
          query = query.where('id', '>', filters.cursor);
        }

        const rows = await query.execute();
        const hasMore = rows.length > filters.limit;
        const trimmed = hasMore ? rows.slice(0, filters.limit) : rows;
        const lastId = trimmed.at(-1)?.id ?? null;
        return {
          users: trimmed.map(mapRowToUser),
          nextCursor: hasMore && lastId ? lastId : null,
        };
      });
    },

    async count(): Promise<number> {
      return withDbErrorMapping('users.count', async () => {
        const row = await db
          .withSchema(IDENTITY)
          .selectFrom('users')
          .select((eb) => eb.fn.count<number>('id').as('total'))
          .executeTakeFirstOrThrow();
        const total = (row as unknown as { total: string | number }).total;
        return typeof total === 'string' ? Number.parseInt(total, 10) : total;
      });
    },
  };
}

function mapRowToUser(row: Database['users']): User {
  return {
    id: row.id,
    email: row.email,
    fullName: row.full_name,
    passwordHash: row.password_hash,
    age: row.age,
    role: row.role,
    active: row.active,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}
