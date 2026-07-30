import { z } from 'zod';
import { PublicUserSchema } from './get-me.schema.js';

export const DeactivateUserOutputSchema = z.object({
  user: PublicUserSchema,
});
export type DeactivateUserOutput = z.infer<typeof DeactivateUserOutputSchema>;
