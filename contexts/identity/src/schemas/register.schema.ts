import { z } from 'zod';

export const RegisterInputSchema = z.object({
  email: z.email().max(200),
  password: z.string().min(8).max(100),
  fullName: z.string().min(2).max(200),
  age: z.number().int().min(13).max(120).optional(),
});

export type RegisterInput = z.infer<typeof RegisterInputSchema>;

export const RegisterOutputSchema = z.object({
  id: z.uuid(),
  email: z.email(),
  fullName: z.string(),
  createdAt: z.string(),
});

export type RegisterOutput = z.infer<typeof RegisterOutputSchema>;
