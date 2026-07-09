import type { Kysely } from 'kysely';
import type { User, CreateUserInput } from '../domain/user.js';

export interface Database {
  users: {
    id: string;
    email: string;
    full_name: string;
    password_hash: string;
    age: number | null;
    created_at: Date;
    updated_at: Date;
  };
}

export interface UserRepository {
  findByEmail(email: string): Promise<User | null>;
  findById(id: string): Promise<User | null>;
  create(input: CreateUserInput): Promise<User>;
  existsByEmail(email: string): Promise<boolean>;
}

export function createUserRepository(db: Kysely<Database>): UserRepository {
  return {
    async findByEmail(email: string): Promise<User | null> {
      const row = await db
        .selectFrom('users')
        .selectAll()
        .where('email', '=', email)
        .executeTakeFirst();
      return row ? mapRowToUser(row) : null;
    },

    async findById(id: string): Promise<User | null> {
      const row = await db
        .selectFrom('users')
        .selectAll()
        .where('id', '=', id)
        .executeTakeFirst();
      return row ? mapRowToUser(row) : null;
    },

    async create(input: CreateUserInput): Promise<User> {
      const id = crypto.randomUUID();
      const now = new Date();
      const row = await db
        .insertInto('users')
        .values({
          id,
          email: input.email,
          full_name: input.fullName,
          password_hash: input.passwordHash,
          age: input.age ?? null,
          created_at: now,
          updated_at: now,
        })
        .returningAll()
        .executeTakeFirstOrThrow();
      return mapRowToUser(row);
    },

    async existsByEmail(email: string): Promise<boolean> {
      const row = await db
        .selectFrom('users')
        .select('id')
        .where('email', '=', email)
        .executeTakeFirst();
      return row !== undefined;
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
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}
