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

import type { Kysely } from 'kysely';
import { withDbErrorMapping } from '@spark-match/shared/infra';
import type { User, CreateUserInput, UserRole } from '../domain/user.js';

export interface Database {
  users: {
    id: string;
    email: string;
    full_name: string;
    password_hash: string;
    age: number | null;
    role: UserRole;
    active: boolean;
    created_at: Date;
    updated_at: Date;
  };
}

const IDENTITY = 'identity';
const DEFAULT_ROLE: UserRole = 'admin';

export interface UserRepository {
  findByEmail(email: string): Promise<User | null>;
  findById(id: string): Promise<User | null>;
  create(input: CreateUserInput): Promise<User>;
  existsByEmail(email: string): Promise<boolean>;
}

export function createUserRepository(db: Kysely<Database>): UserRepository {
  return {
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
