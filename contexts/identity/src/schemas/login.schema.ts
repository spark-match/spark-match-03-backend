import { z } from 'zod';

export const LoginInputSchema = z.object({
  email: z.string().email().max(200),
  password: z.string().min(8).max(100),
});

export type LoginInput = z.infer<typeof LoginInputSchema>;

export const LoginOutputSchema = z.object({
  accessToken: z.string(),
  expiresIn: z.number().int(),
  user: z.object({
    id: z.string().uuid(),
    email: z.string().email(),
    fullName: z.string(),
  }),
});

export type LoginOutput = z.infer<typeof LoginOutputSchema>;
