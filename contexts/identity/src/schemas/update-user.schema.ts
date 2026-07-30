import { z } from 'zod';
import { PublicUserSchema } from './get-me.schema.js';

export const UpdateUserInputSchema = z
  .object({
    fullName: z.string().min(2).max(200).optional(),
    age: z.number().int().min(13).max(120).nullable().optional(),
    role: z.literal('admin').optional(),
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
