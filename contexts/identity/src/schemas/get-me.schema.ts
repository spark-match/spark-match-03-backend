import { z } from 'zod';

/**
 * Public projection of a `User`, safe to return over HTTP.
 * Mirrors `domain/user.ts:toPublicUser()` — kept in sync manually
 * (no compile-time link by design; see ADR-013).
 */
export const PublicUserSchema = z.object({
  id: z.uuid(),
  email: z.email(),
  fullName: z.string(),
  age: z.number().int().min(13).max(120).nullable(),
  // Must list every value in `USER_ROLES` (domain/user.ts). ADR-013 keeps this
  // link manual on purpose, so `user.test.ts` asserts the two agree at runtime:
  // widening the domain and forgetting this file publishes an OpenAPI contract
  // that claims a role the API can no longer return.
  role: z.enum(['admin', 'student']),
  active: z.boolean(),
  createdAt: z.iso.datetime(),
  updatedAt: z.iso.datetime(),
});
export type PublicUser = z.infer<typeof PublicUserSchema>;

// `GetMeOutputSchema` is the same shape as `PublicUserSchema` (the
// public projection of any user). We re-export it under the per-route
// name so the OpenAPI generator can document /v1/users/me specifically
// and the runtime typecheck for the handler stays type-narrow.
export const GetMeOutputSchema = PublicUserSchema;
