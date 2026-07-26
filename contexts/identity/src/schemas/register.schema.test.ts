import { describe, it, expect } from 'vitest';
import { RegisterInputSchema, RegisterOutputSchema } from './register.schema.js';

describe('RegisterInputSchema', () => {
  it('accepts a valid input without age', () => {
    const result = RegisterInputSchema.parse({
      email: 'user@example.com',
      password: 'supersecret123',
      fullName: 'Ada Lovelace',
    });
    expect(result.age).toBeUndefined();
  });

  it('accepts a valid input with age', () => {
    const result = RegisterInputSchema.parse({
      email: 'user@example.com',
      password: 'supersecret123',
      fullName: 'Ada Lovelace',
      age: 36,
    });
    expect(result.age).toBe(36);
  });

  it('rejects an invalid email', () => {
    expect(() =>
      RegisterInputSchema.parse({
        email: 'not-an-email',
        password: 'supersecret123',
        fullName: 'Ada Lovelace',
      }),
    ).toThrow();
  });

  it('rejects a password under 8 chars', () => {
    expect(() =>
      RegisterInputSchema.parse({
        email: 'user@example.com',
        password: 'short',
        fullName: 'Ada Lovelace',
      }),
    ).toThrow();
  });

  it('rejects a fullName under 2 chars', () => {
    expect(() =>
      RegisterInputSchema.parse({
        email: 'user@example.com',
        password: 'supersecret123',
        fullName: 'A',
      }),
    ).toThrow();
  });

  it('rejects age below 13', () => {
    expect(() =>
      RegisterInputSchema.parse({
        email: 'user@example.com',
        password: 'supersecret123',
        fullName: 'Ada Lovelace',
        age: 12,
      }),
    ).toThrow();
  });

  it('rejects age above 120', () => {
    expect(() =>
      RegisterInputSchema.parse({
        email: 'user@example.com',
        password: 'supersecret123',
        fullName: 'Ada Lovelace',
        age: 121,
      }),
    ).toThrow();
  });
});

describe('RegisterOutputSchema', () => {
  it('accepts a valid output', () => {
    const result = RegisterOutputSchema.parse({
      id: '3a8e6c4e-1f3a-4f0e-9a3d-1c2b3a4d5e6f',
      email: 'a@b.com',
      fullName: 'Ada',
      createdAt: '2026-01-01T00:00:00.000Z',
    });
    expect(result.createdAt).toBe('2026-01-01T00:00:00.000Z');
  });

  it('rejects a non-uuid id', () => {
    expect(() =>
      RegisterOutputSchema.parse({
        id: 'bad',
        email: 'a@b.com',
        fullName: 'Ada',
        createdAt: '2026-01-01T00:00:00.000Z',
      }),
    ).toThrow();
  });
});
