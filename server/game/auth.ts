import { randomBytes, scryptSync, timingSafeEqual } from 'node:crypto';

/**
 * Account credentials. Kept apart from the rest of the game logic because it is
 * the only part that needs Node's crypto — everything else in server/ runs
 * unchanged in a browser, which is what the single-file build depends on.
 */

export function hashPassword(password: string): string {
  const salt = randomBytes(16).toString('hex');
  const hash = scryptSync(password, salt, 32).toString('hex');
  return `${salt}:${hash}`;
}

export function verifyPassword(password: string, stored: string): boolean {
  const [salt, hash] = stored.split(':');
  if (!salt || !hash) return false;
  const attempt = scryptSync(password, salt, 32);
  const expected = Buffer.from(hash, 'hex');
  return attempt.length === expected.length && timingSafeEqual(attempt, expected);
}

export function newToken(): string {
  return randomBytes(24).toString('hex');
}
