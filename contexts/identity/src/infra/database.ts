// =============================================================================
// Database - shared Kysely schema for the identity context
// =============================================================================
// Single source of truth for the table-row types that Kysely uses to type
// queries. Shared by user-repository.ts and audit-repository.ts.
//
// Convention: snake_case columns match the Postgres schema exactly
// (see migrations/V001..V004). Each context that owns its own schema
// should have its own database.ts at the same path.
//
// Generated columns (BIGSERIAL, DEFAULT current_timestamp) use Kysely's
// `Generated<T>` so inserts don't require them. JSONB columns use
// `JSONColumnType<SelectType, string, string>` (string at the DB boundary).
// =============================================================================

import type { ColumnType, Generated } from 'kysely';
import type { UserRole } from '../domain/user.js';

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
  audit_log: {
    id: Generated<number>;
    occurred_at: Generated<Date>;
    action: string;
    actor_user_id: string | null;
    subject_user_id: string | null;
    metadata: ColumnType<Record<string, unknown>, string, string>;
  };
}
