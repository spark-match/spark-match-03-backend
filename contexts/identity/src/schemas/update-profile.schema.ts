import { z } from 'zod';

export const UpdateProfileInputSchema = z.object({
  fullName: z.string().min(2).max(200).optional(),
  age: z.number().int().min(13).max(120).nullable().optional(),
});

export type UpdateProfileInput = z.infer<typeof UpdateProfileInputSchema>;

export interface UpdateProfileOutput {
  id: string;
  email: string;
  fullName: string;
  age: number | null;
  role: string;
  active: boolean;
  createdAt: string;
  updatedAt: string;
}