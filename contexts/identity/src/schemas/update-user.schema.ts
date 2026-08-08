import { z } from 'zod';
import { PublicUserSchema } from './get-me.schema.js';

/**
 * Careful: this schema is NOT what `PATCH /v1/users/{userId}` validates.
 *
 * handlers/update-user.ts uses `UpdateProfileInputSchema`, which only declares
 * `fullName` and `age`, so Zod strips `role` and `active` before the service
 * ever sees them. The service does implement both -- it has the isSelf and
 * isAdmin branches, the `roleChanged` flag and the audit entry -- but no
 * request can reach that code, and `setRole` in infra/user-repository.ts:156
 * has no caller either.
 *
 * The practical consequence, as of 2026-08-08: there is NO way to grant or
 * revoke a role through the API. It can only be done with direct SQL. That is
 * why migration 005 does not demote existing accounts -- doing so with nobody
 * left as admin would be unrecoverable through the product itself.
 *
 * Widening the role here keeps it honest rather than making it reachable:
 * exposing role changes over HTTP is a separate change that needs its own
 * security review, not a line added to an unrelated fix.
 */
export const UpdateUserInputSchema = z
  .object({
    fullName: z.string().min(2).max(200).optional(),
    age: z.number().int().min(13).max(120).nullable().optional(),
    role: z.enum(['admin', 'student']).optional(),
    active: z.boolean().optional(),
  })
  .refine(
    (data) =>
      data.fullName !== undefined ||
      data.age !== undefined ||
      data.role !== undefined ||
      data.active !== undefined,
    { message: 'at least one field must be provided' },
  );
export type UpdateUserInput = z.infer<typeof UpdateUserInputSchema>;

export const UpdateUserOutputSchema = z.object({
  user: PublicUserSchema,
});
export type UpdateUserOutput = z.infer<typeof UpdateUserOutputSchema>;
