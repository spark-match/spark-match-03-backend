import { z } from 'zod';

export const ListUsersInputSchema = z.object({});

export type ListUsersInput = z.infer<typeof ListUsersInputSchema>;

export interface ListUsersOutput {
  users: Array<{
    id: string;
    email: string;
    fullName: string;
    age: number | null;
    role: string;
    active: boolean;
    createdAt: string;
    updatedAt: string;
  }>;
  nextCursor: string | null;
}