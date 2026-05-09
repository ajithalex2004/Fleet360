/**
 * Password policy + hashing helpers.
 *
 * Hash format matches /api/auth/login: `salt:hash` hex (PBKDF2-SHA512,
 * 100k iterations, 64-byte derived key).
 *
 * Reset-token format: 32 random bytes hex, stored as sha256 hash so the
 * raw token never lands in the database.
 */

import crypto from 'crypto';

export interface PasswordPolicy {
  minLength: number;
  requireUpper: boolean;
  requireLower: boolean;
  requireDigit: boolean;
  requireSymbol: boolean;
  rejectCommon: boolean;
  rejectIdentifier: boolean; // refuse passwords containing email/username
}

export const DEFAULT_PASSWORD_POLICY: PasswordPolicy = {
  minLength: 10,
  requireUpper: true,
  requireLower: true,
  requireDigit: true,
  requireSymbol: true,
  rejectCommon: true,
  rejectIdentifier: true,
};

const COMMON_PASSWORDS = new Set([
  'password', 'password1', 'password123', 'qwerty', 'qwerty123',
  '12345678', '123456789', '1234567890', 'letmein', 'welcome',
  'admin', 'admin123', 'iloveyou', 'monkey', 'football', 'dragon',
  'baseball', 'sunshine', 'master', 'hello123', 'shadow', 'abc123',
]);

export interface ValidationResult {
  ok: boolean;
  errors: string[];
}

export function validatePassword(
  pw: string,
  identity: { email?: string; username?: string },
  policy: PasswordPolicy = DEFAULT_PASSWORD_POLICY,
): ValidationResult {
  const errors: string[] = [];
  if (typeof pw !== 'string') {
    return { ok: false, errors: ['Password is required'] };
  }
  if (pw.length < policy.minLength) errors.push(`Must be at least ${policy.minLength} characters`);
  if (policy.requireUpper  && !/[A-Z]/.test(pw))    errors.push('Must contain an uppercase letter');
  if (policy.requireLower  && !/[a-z]/.test(pw))    errors.push('Must contain a lowercase letter');
  if (policy.requireDigit  && !/\d/.test(pw))       errors.push('Must contain a digit');
  if (policy.requireSymbol && !/[^A-Za-z0-9]/.test(pw)) errors.push('Must contain a symbol');

  if (policy.rejectCommon && COMMON_PASSWORDS.has(pw.toLowerCase())) {
    errors.push('That password is on a list of breached passwords — choose something else');
  }
  if (policy.rejectIdentifier) {
    const lower = pw.toLowerCase();
    const emailLocal = identity.email?.split('@')[0]?.toLowerCase();
    if (emailLocal && emailLocal.length >= 4 && lower.includes(emailLocal)) {
      errors.push('Password must not contain your email');
    }
    const uname = identity.username?.toLowerCase();
    if (uname && uname.length >= 4 && lower.includes(uname)) {
      errors.push('Password must not contain your username');
    }
  }
  return { ok: errors.length === 0, errors };
}

/** Returns `salt:hash` hex matching the format /api/auth/login expects. */
export function hashPassword(plaintext: string): string {
  const salt = crypto.randomBytes(16).toString('hex');
  const hash = crypto.pbkdf2Sync(plaintext, salt, 100_000, 64, 'sha512').toString('hex');
  return `${salt}:${hash}`;
}

export function verifyPassword(plaintext: string, stored: string): boolean {
  try {
    const [salt, hash] = stored.split(':');
    if (!salt || !hash) return false;
    const derived = crypto.pbkdf2Sync(plaintext, salt, 100_000, 64, 'sha512').toString('hex');
    const a = Buffer.from(derived, 'hex');
    const b = Buffer.from(hash, 'hex');
    if (a.length !== b.length) return false;
    return crypto.timingSafeEqual(a, b);
  } catch {
    return false;
  }
}

/** sha256 hex — used for reset-token storage so raw token never lands in DB. */
export function hashToken(raw: string): string {
  return crypto.createHash('sha256').update(raw).digest('hex');
}

/** 32 random bytes as hex (the value sent in the reset-link URL). */
export function generateResetToken(): { token: string; hash: string } {
  const token = crypto.randomBytes(32).toString('hex');
  return { token, hash: hashToken(token) };
}
