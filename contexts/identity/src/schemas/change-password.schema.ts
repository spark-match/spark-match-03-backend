import { z } from 'zod';

export const ChangePasswordInputSchema = z.object({
  newPassword: z.string().min(8).max(100),
});

export type ChangePasswordInput = z.infer<typeof ChangePasswordInputSchema>;

export type ChangePasswordOutput = {
  message: 'password updated';
};