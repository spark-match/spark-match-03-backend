import { z } from 'zod';

export const LoginInputSchema = z.object({
  email: z.email().max(200),
  password: z.string().min(8).max(100),
});

export type LoginInput = z.infer<typeof LoginInputSchema>;

export const LoginOutputSchema = z.object({
  accessToken: z.string(),
  expiresIn: z.number().int(),
  user: z.object({
    id: z.uuid(),
    email: z.email(),
    fullName: z.string(),
  }),
});

export type LoginOutput = z.infer<typeof LoginOutputSchema>;
