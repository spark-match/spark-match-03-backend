import { z } from 'zod';

/**
 * `currentPassword` is required: changing your own password means proving you
 * know the old one.
 *
 * Until 2026-08-08 this schema asked only for `newPassword`, so a valid access
 * token was enough to take an account over -- set a new password, and the
 * owner is locked out without the attacker ever knowing the old one.
 *
 * No `.min(8)` on the current password on purpose: it is compared against the
 * stored hash, not created, and applying today's policy to it would reject
 * legitimate owners whose password predates that policy.
 */
export const ChangePasswordInputSchema = z.object({
  currentPassword: z.string().min(1).max(100),
  newPassword: z.string().min(8).max(100),
});
export type ChangePasswordInput = z.infer<typeof ChangePasswordInputSchema>;

export const ChangePasswordOutputSchema = z.object({
  message: z.literal('password updated'),
});
export type ChangePasswordOutput = z.infer<typeof ChangePasswordOutputSchema>;
