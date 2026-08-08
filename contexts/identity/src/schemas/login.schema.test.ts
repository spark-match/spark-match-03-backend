import { describe, it, expect } from 'vitest';
import { LoginInputSchema, LoginOutputSchema } from './login.schema.js';

describe('LoginInputSchema', () => {
  it('accepts a valid email + password', () => {
    const result = LoginInputSchema.parse({
      email: 'user@example.com',
      password: 'supersecret123',
    });
    expect(result.email).toBe('user@example.com');
  });

  it('rejects an invalid email', () => {
    expect(() => LoginInputSchema.parse({ email: 'not-an-email', password: 'supersecret123' })).toThrow();
  });

  it('rejects an email over 200 chars', () => {
    const email = 'a'.repeat(190) + '@example.com';
    expect(() => LoginInputSchema.parse({ email, password: 'supersecret123' })).toThrow();
  });

  it('rejects a password under 8 chars', () => {
    expect(() => LoginInputSchema.parse({ email: 'user@example.com', password: 'short' })).toThrow();
  });

  it('rejects a password over 100 chars', () => {
    expect(() =>
      LoginInputSchema.parse({ email: 'user@example.com', password: 'a'.repeat(101) }),
    ).toThrow();
  });
});

describe('LoginOutputSchema', () => {
  it('accepts a valid output', () => {
    const result = LoginOutputSchema.parse({
      accessToken: 'token',
      expiresIn: 86400,
      user: {
        id: '3a8e6c4e-1f3a-4f0e-9a3d-1c2b3a4d5e6f',
        email: 'a@b.com',
        fullName: 'Ada',
        role: 'student',
      },
    });
    expect(result.user.fullName).toBe('Ada');
    expect(result.user.role).toBe('student');
  });

  it('rechaza una respuesta de login sin rol', () => {
    // El rol es obligatorio a proposito. Si fuera opcional, el cliente tendria
    // que decidir que hacer cuando falta, y "no se el rol" acabaria tratandose
    // como "es admin" en algun sitio, que es como empezo todo esto.
    expect(() =>
      LoginOutputSchema.parse({
        accessToken: 'token',
        expiresIn: 86400,
        user: { id: '3a8e6c4e-1f3a-4f0e-9a3d-1c2b3a4d5e6f', email: 'a@b.com', fullName: 'Ada' },
      }),
    ).toThrow();
  });

  it('rejects a non-uuid user id', () => {
    expect(() =>
      LoginOutputSchema.parse({
        accessToken: 'token',
        expiresIn: 86400,
        user: { id: 'not-a-uuid', email: 'a@b.com', fullName: 'Ada' },
      }),
    ).toThrow();
  });

  it('rejects a non-integer expiresIn', () => {
    expect(() =>
      LoginOutputSchema.parse({
        accessToken: 'token',
        expiresIn: 1.5,
        user: { id: '3a8e6c4e-1f3a-4f0e-9a3d-1c2b3a4d5e6f', email: 'a@b.com', fullName: 'Ada' },
      }),
    ).toThrow();
  });
});
