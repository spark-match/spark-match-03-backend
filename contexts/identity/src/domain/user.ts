// =============================================================================
// User domain types
// =============================================================================
// Single source of truth for the User aggregate, including the (currently
// single-valued) role enum and the public projection used by HTTP responses.
// =============================================================================

export interface User {
  id: string;
  email: string;
  fullName: string;
  passwordHash: string;
  age: number | null;
  role: UserRole;
  active: boolean;
  createdAt: Date;
  updatedAt: Date;
}

/**
 * The set of roles a user may hold. Single-valued today (admin-only) by
 * design; the runtime enforces that the `role` column may only contain one
 * of these literals. A future reviewer/operator role would be added here
 * AND in the V003 migration's CHECK constraint together.
 */
export type UserRole = 'admin';

export const USER_ROLES: readonly UserRole[] = ['admin'];

export type CreateUserInput = {
  email: string;
  fullName: string;
  passwordHash: string;
  age?: number;
};

/**
 * Fields a self-update may touch. Excludes role and active (admin-only).
 */
export type UpdateUserInput = {
  fullName?: string;
  age?: number | null;
};

/**
 * The user projection safe to return over HTTP (no passwordHash).
 */
export type PublicUser = Omit<User, 'passwordHash'>;

export function toPublicUser(user: User): PublicUser {
  return {
    id: user.id,
    email: user.email,
    fullName: user.fullName,
    age: user.age,
    role: user.role,
    active: user.active,
    createdAt: user.createdAt,
    updatedAt: user.updatedAt,
  };
}
