import { z } from 'zod';
import { PublicUserSchema } from './get-me.schema.js';

export const UpdateProfileInputSchema = z.object({
  fullName: z.string().min(2).max(200).optional(),
  age: z.number().int().min(13).max(120).nullable().optional(),
});
export type UpdateProfileInput = z.infer<typeof UpdateProfileInputSchema>;

export const UpdateProfileOutputSchema = PublicUserSchema;
export type UpdateProfileOutput = z.infer<typeof UpdateProfileOutputSchema>;
