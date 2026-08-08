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
 * The set of roles a user may hold. Must be kept in sync with the CHECK
 * constraint on `identity.users.role` -- see migration 005.
 *
 * `student` is what self-registration produces. `admin` is granted
 * deliberately and is deliberately NOT reachable through the public API.
 *
 * This union was `'admin'` alone until 2026-08-08, and that is worth
 * remembering rather than tidying away. Every authorisation check in this
 * context compares against 'admin'; with a single-valued union and a matching
 * DEFAULT, those comparisons could never be false. The access control existed,
 * was reviewed and was tested, and denied nothing. A role enum with one member
 * is not a simplification, it is an authorisation system with the check
 * removed -- see the guard in user.test.ts that now fails if it happens again.
 */
export type UserRole = 'admin' | 'student';

export const USER_ROLES: readonly UserRole[] = ['admin', 'student'];

/**
 * The role assigned to anyone who signs up through the public endpoint.
 * Exported so the repository and the tests read it from the same place
 * instead of each repeating the literal.
 */
export const SELF_REGISTRATION_ROLE: UserRole = 'student';

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
