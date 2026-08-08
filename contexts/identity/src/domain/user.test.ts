// =============================================================================
// user domain - role invariants
// =============================================================================
// These are not behaviour tests. They guard the shape of the role enum itself,
// because the shape is what failed.
//
// Until 2026-08-08 `UserRole` was the single literal 'admin', the column
// DEFAULT was 'admin' and the CHECK constraint allowed nothing else. Every
// authorisation branch in this context is written as `role === 'admin'`, so
// with one possible value none of them could ever deny anything. The access
// control was written, reviewed and covered by tests, and it enforced nothing.
// Meanwhile POST /v1/auth/register is public, so signing up granted
// administrative access to the user list and the audit log.
//
// A test asserting "an admin can read the audit log" passes in both worlds and
// therefore proves nothing. What follows asserts the properties that were
// false: that more than one role exists, and that self-registration does not
// land on the privileged one.
// =============================================================================

import { describe, it, expect } from 'vitest';
import { USER_ROLES, SELF_REGISTRATION_ROLE, type UserRole } from './user.js';
import { PublicUserSchema } from '../schemas/get-me.schema.js';

describe('user roles', () => {
  it('has more than one role, so the authorisation checks can deny', () => {
    expect(USER_ROLES.length).toBeGreaterThan(1);
  });

  it('offers at least one role that is not admin', () => {
    const noPrivilegiados = USER_ROLES.filter((r) => r !== 'admin');
    expect(noPrivilegiados.length).toBeGreaterThan(0);
  });

  it('does not put self-registration on the privileged role', () => {
    // The whole vulnerability in one assertion: registering is public, so if
    // this lands on 'admin' every visitor becomes an administrator.
    expect(SELF_REGISTRATION_ROLE).not.toBe('admin');
    expect(USER_ROLES).toContain(SELF_REGISTRATION_ROLE);
  });

  it('keeps the published schema in step with the domain', () => {
    // ADR-013 keeps the Zod schema and the domain type unlinked at compile
    // time on purpose, so the drift has to be caught at runtime. Widening one
    // and forgetting the other publishes an OpenAPI contract that disagrees
    // with what the API can actually return.
    const aceptados = USER_ROLES.filter(
      (role) => PublicUserSchema.shape.role.safeParse(role).success,
    );
    expect(aceptados).toEqual([...USER_ROLES]);

    const inventado = 'operator' as UserRole;
    expect(PublicUserSchema.shape.role.safeParse(inventado).success).toBe(false);
  });
});
