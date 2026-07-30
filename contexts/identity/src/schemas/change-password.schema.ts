import { z } from 'zod';

export const ChangePasswordInputSchema = z.object({
  newPassword: z.string().min(8).max(100),
});
export type ChangePasswordInput = z.infer<typeof ChangePasswordInputSchema>;

export const ChangePasswordOutputSchema = z.object({
  message: z.literal('password updated'),
});
export type ChangePasswordOutput = z.infer<typeof ChangePasswordOutputSchema>;
