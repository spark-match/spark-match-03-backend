import { describe, it, expect } from 'vitest';
import { hashPassword, verifyPassword } from './hash-password.js';

describe('hashPassword', () => {
  it('hashes and verifies a password', async () => {
    const hashed = await hashPassword('mySecurePass123');
    expect(hashed).toMatch(/^scrypt\$\d+\$\d+\$\d+\$[A-Za-z0-9_-]+\$[A-Za-z0-9_-]+$/);
    expect(await verifyPassword('mySecurePass123', hashed)).toBe(true);
  });

  it('rejects wrong password', async () => {
    const hashed = await hashPassword('mySecurePass123');
    expect(await verifyPassword('wrong', hashed)).toBe(false);
  });

  it('throws on short password', async () => {
    await expect(hashPassword('short')).rejects.toThrow();
  });

  it('produces different hashes for the same password (random salt)', async () => {
    const a = await hashPassword('mySecurePass123');
    const b = await hashPassword('mySecurePass123');
    expect(a).not.toBe(b);
    expect(await verifyPassword('mySecurePass123', a)).toBe(true);
    expect(await verifyPassword('mySecurePass123', b)).toBe(true);
  });

  it('rejects malformed encoded values', async () => {
    expect(await verifyPassword('p', 'not-a-real-encoding')).toBe(false);
    expect(await verifyPassword('p', 'bcrypt$1$2$3$4$5')).toBe(false);
  });
});
