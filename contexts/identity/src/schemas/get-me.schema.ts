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

// Convenience alias for the GET /v1/users/me response. Some handlers
// (audit.ts) need the return type, not the schema itself.
export type GetMeOutput = PublicUser;

export const GetMeOutputSchema = PublicUserSchema;
