import { z } from 'zod';
import { PublicUserSchema } from './get-me.schema.js';

export const ActivateUserOutputSchema = z.object({
  user: PublicUserSchema,
});
export type ActivateUserOutput = z.infer<typeof ActivateUserOutputSchema>;
