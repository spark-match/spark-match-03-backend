import { createHash, randomBytes, scryptSync, timingSafeEqual } from 'node:crypto';

const SCRYPT_KEYLEN = 64;
const SCRYPT_SALT_BYTES = 16;

export function hashPassword(password: string): string {
  if (password.length < 8) {
    throw new Error('Password must be at least 8 characters long');
  }
  const salt = randomBytes(SCRYPT_SALT_BYTES);
  const hash = scryptSync(password.normalize('NFKC'), salt, SCRYPT_KEYLEN);
  return `scrypt$${salt.toString('hex')}$${hash.toString('hex')}`;
}

export function verifyPassword(password: string, stored: string): boolean {
  const parts = stored.split('$');
  if (parts.length !== 3 || parts[0] !== 'scrypt') {
    return false;
  }
  const saltHex = parts[1]!;
  const hashHex = parts[2]!;
  const salt = Buffer.from(saltHex, 'hex');
  const expected = Buffer.from(hashHex, 'hex');
  const actual = scryptSync(password.normalize('NFKC'), salt, expected.length);
  return timingSafeEqual(expected, actual);
}

export function sha256(input: string): string {
  return createHash('sha256').update(input).digest('hex');
}
