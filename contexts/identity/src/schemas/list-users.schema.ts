import { z } from 'zod';
import { PublicUserSchema } from './get-me.schema.js';

export const ListUsersInputSchema = z.object({
  query: z.object({
    limit: z.coerce.number().int().min(1).max(100).optional(),
    cursor: z.string().optional(),
    active: z.enum(['true', 'false', 'all']).optional(),
    role: z.enum(['admin', 'student']).optional(),
  }).optional(),
});
export type ListUsersInput = z.infer<typeof ListUsersInputSchema>;

export const ListUsersOutputSchema = z.object({
  users: z.array(PublicUserSchema),
  nextCursor: z.string().nullable(),
});
export type ListUsersOutput = z.infer<typeof ListUsersOutputSchema>;
