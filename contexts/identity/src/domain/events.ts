// =============================================================================
// Domain events for the identity bounded context
// =============================================================================
// All events share the envelope `{ version, data }` produced by
// `makeDomainEvent` in `@spark-match/shared/events`. The `version` field
// allows future evolution of any individual payload without breaking
// downstream consumers.
//
// Source: 'spark-match.identity'
// Detail type naming: PascalCase, present-tense verb (UserRegistered,
// UserPasswordChanged, UserRoleChanged, ...).
//
// SAFETY: event payloads MUST NOT include passwordHash, JWTs, or other
// secrets. They are broadcast to the event bus and consumed by any
// subscribed context.
// =============================================================================

import { z } from 'zod';

const OccurredAt = z.iso.datetime();
const UserId = z.uuid();
const Email = z.email();

const BaseFields = {
  schemaVersion: z.literal('1.0'),
  occurredAt: OccurredAt,
} as const;

export const UserRegisteredEventSchema = z.object({
  ...BaseFields,
  userId: UserId,
  email: Email,
  fullName: z.string(),
});

export type UserRegisteredEvent = z.infer<typeof UserRegisteredEventSchema>;

export const UserLoggedInEventSchema = z.object({
  ...BaseFields,
  userId: UserId,
  email: Email,
});

export type UserLoggedInEvent = z.infer<typeof UserLoggedInEventSchema>;

export const UserPasswordChangedEventSchema = z.object({
  ...BaseFields,
  userId: UserId,
});

export type UserPasswordChangedEvent = z.infer<typeof UserPasswordChangedEventSchema>;

export const UserUpdatedEventSchema = z.object({
  ...BaseFields,
  userId: UserId,
  changes: z.record(z.string(), z.unknown()),
});

export type UserUpdatedEvent = z.infer<typeof UserUpdatedEventSchema>;

export const UserDeactivatedEventSchema = z.object({
  ...BaseFields,
  userId: UserId,
});

export type UserDeactivatedEvent = z.infer<typeof UserDeactivatedEventSchema>;

export const UserActivatedEventSchema = z.object({
  ...BaseFields,
  userId: UserId,
});

export type UserActivatedEvent = z.infer<typeof UserActivatedEventSchema>;

export const UserRoleChangedEventSchema = z.object({
  ...BaseFields,
  userId: UserId,
  fromRole: z.string(),
  toRole: z.string(),
});

export type UserRoleChangedEvent = z.infer<typeof UserRoleChangedEventSchema>;
