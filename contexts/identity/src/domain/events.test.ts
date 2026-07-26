import { describe, it, expect } from 'vitest';
import {
  UserRegisteredEventSchema,
  UserLoggedInEventSchema,
  UserUpdatedEventSchema,
} from './events.js';

const validUuid = '3a8e6c4e-1f3a-4f0e-9a3d-1c2b3a4d5e6f';
const validDate = '2026-01-01T00:00:00.000Z';

describe('UserRegisteredEventSchema', () => {
  it('accepts a valid payload', () => {
    const result = UserRegisteredEventSchema.safeParse({
      schemaVersion: '1.0',
      userId: validUuid,
      email: 'a@b.com',
      fullName: 'Ada',
      occurredAt: validDate,
    });
    expect(result.success).toBe(true);
  });

  it('rejects an unknown schemaVersion', () => {
    const result = UserRegisteredEventSchema.safeParse({
      schemaVersion: '2.0',
      userId: validUuid,
      email: 'a@b.com',
      fullName: 'Ada',
      occurredAt: validDate,
    });
    expect(result.success).toBe(false);
  });

  it('rejects a non-uuid userId', () => {
    const result = UserRegisteredEventSchema.safeParse({
      schemaVersion: '1.0',
      userId: 'not-a-uuid',
      email: 'a@b.com',
      fullName: 'Ada',
      occurredAt: validDate,
    });
    expect(result.success).toBe(false);
  });

  it('rejects a non-email email', () => {
    const result = UserRegisteredEventSchema.safeParse({
      schemaVersion: '1.0',
      userId: validUuid,
      email: 'not-an-email',
      fullName: 'Ada',
      occurredAt: validDate,
    });
    expect(result.success).toBe(false);
  });

  it('rejects a non-datetime occurredAt', () => {
    const result = UserRegisteredEventSchema.safeParse({
      schemaVersion: '1.0',
      userId: validUuid,
      email: 'a@b.com',
      fullName: 'Ada',
      occurredAt: 'yesterday',
    });
    expect(result.success).toBe(false);
  });
});

describe('UserLoggedInEventSchema', () => {
  it('accepts a valid payload', () => {
    const result = UserLoggedInEventSchema.safeParse({
      schemaVersion: '1.0',
      userId: validUuid,
      email: 'a@b.com',
      occurredAt: validDate,
    });
    expect(result.success).toBe(true);
  });

  it('rejects an unknown schemaVersion', () => {
    const result = UserLoggedInEventSchema.safeParse({
      schemaVersion: '0.9',
      userId: validUuid,
      email: 'a@b.com',
      occurredAt: validDate,
    });
    expect(result.success).toBe(false);
  });

  it('rejects a non-uuid userId', () => {
    const result = UserLoggedInEventSchema.safeParse({
      schemaVersion: '1.0',
      userId: 'bad',
      email: 'a@b.com',
      occurredAt: validDate,
    });
    expect(result.success).toBe(false);
  });
});

describe('UserUpdatedEventSchema', () => {
  it('accepts a valid payload with empty changes', () => {
    const result = UserUpdatedEventSchema.safeParse({
      schemaVersion: '1.0',
      userId: validUuid,
      changes: {},
      occurredAt: validDate,
    });
    expect(result.success).toBe(true);
  });

  it('accepts a valid payload with arbitrary change values', () => {
    const result = UserUpdatedEventSchema.safeParse({
      schemaVersion: '1.0',
      userId: validUuid,
      changes: { fullName: { from: 'Ada', to: 'Augusta' } },
      occurredAt: validDate,
    });
    expect(result.success).toBe(true);
  });

  it('rejects an unknown schemaVersion', () => {
    const result = UserUpdatedEventSchema.safeParse({
      schemaVersion: '2.5',
      userId: validUuid,
      changes: {},
      occurredAt: validDate,
    });
    expect(result.success).toBe(false);
  });

  it('rejects a non-uuid userId', () => {
    const result = UserUpdatedEventSchema.safeParse({
      schemaVersion: '1.0',
      userId: 'not-a-uuid',
      changes: {},
      occurredAt: validDate,
    });
    expect(result.success).toBe(false);
  });
});
