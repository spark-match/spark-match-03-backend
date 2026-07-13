import { z } from 'zod';

export const UserRegisteredEventSchema = z.object({
  schemaVersion: z.literal('1.0'),
  userId: z.string().uuid(),
  email: z.string().email(),
  fullName: z.string(),
  occurredAt: z.string().datetime(),
});

export type UserRegisteredEvent = z.infer<typeof UserRegisteredEventSchema>;

export const UserLoggedInEventSchema = z.object({
  schemaVersion: z.literal('1.0'),
  userId: z.string().uuid(),
  email: z.string().email(),
  occurredAt: z.string().datetime(),
});

export type UserLoggedInEvent = z.infer<typeof UserLoggedInEventSchema>;

export const ProfileUpdatedEventSchema = z.object({
  schemaVersion: z.literal('1.0'),
  userId: z.string().uuid(),
  changes: z.record(z.unknown()),
  occurredAt: z.string().datetime(),
});

export type ProfileUpdatedEvent = z.infer<typeof ProfileUpdatedEventSchema>;
