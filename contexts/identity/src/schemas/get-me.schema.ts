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
  role: z.literal('admin'),
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
