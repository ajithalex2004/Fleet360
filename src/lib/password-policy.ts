/**
 * Password policy + hashing — Smart Mobility platform.
 *
 * Hash format matches the existing PBKDF2 scheme already used by
 * /api/auth/login and /api/tenants/provision: `salt:hashHex` where
 *   - salt: 16 random bytes hex
 *   - hash: pbkdf2(plaintext, salt, 100_000, 64, sha512) hex
 * No bcrypt dep; uses Node's built-in crypto.
 */

import crypto from 'crypto';

/* ── Policy ────────────────────────────────────────────────────────────── */

export interface PasswordPolicyOptions {
  minLength: number;
  requireUppercase: boolean;
  requireLowercase: boolean;
  requireDigit: boolean;
  requireSymbol: boolean;
  /** Block top-N most common passwords. */
  rejectCommon: boolean;
  /** Reject passwords that contain the user's email/username (case-insensitive). */
  rejectIdentifier: boolean;
}

export const DEFAULT_PASSWORD_POLICY: PasswordPolicyOptions = {
  minLength: 10,
  requireUppercase: true,
  requireLowercase: true,
  requireDigit: true,
  requireSymbol: true,
  rejectCommon: true,
  rejectIdentifier: true,
};

const COMMON_PASSWORDS = new Set([
  'password', 'password1', 'password123', 'qwerty', 'abc123', '123456', '12345678',
  'admin', 'admin123', 'welcome', 'welcome1', 'letmein', 'iloveyou', '1q2w3e4r',
  'changeme', 'monkey', 'dragon', 'sunshine', 'trustno1', 'azerty', 'qwerty123',
  'p@ssword', 'p@ssw0rd', 'password!', 'admin@123', 'tripexl', 'tripxl', 'fleet360',
]);

export interface ValidationResult {
  ok: boolean;
  errors: string[];
}

export function validatePassword(
  plaintext: string,
  identifiers: { email?: string; username?: string } = {},
  policy: PasswordPolicyOptions = DEFAULT_PASSWORD_POLICY,
): ValidationResult {
  const errors: string[] = [];
  if (typeof plaintext !== 'string' || plaintext.length === 0) {
    return { ok: false, errors: ['Password is required.'] };
  }
  if (plaintext.length < policy.minLength) {
    errors.push(`Must be at least ${policy.minLength} characters.`);
  }
  if (policy.requireUppercase && !/[A-Z]/.test(plaintext)) {
    errors.push('Must contain at least one uppercase letter.');
  }
  if (policy.requireLowercase && !/[a-z]/.test(plaintext)) {
    errors.push('Must contain at least one lowercase letter.');
  }
  if (policy.requireDigit && !/\d/.test(plaintext)) {
    errors.push('Must contain at least one digit.');
  }
  if (policy.requireSymbol && !/[^A-Za-z0-9]/.test(plaintext)) {
    errors.push('Must contain at least one symbol (e.g. !@#$%).');
  }
  if (policy.rejectCommon && COMMON_PASSWORDS.has(plaintext.toLowerCase())) {
    errors.push('Password is too common — pick something less guessable.');
  }
  if (policy.rejectIdentifier) {
    const lower = plaintext.toLowerCase();
    const email = identifiers.email?.toLowerCase();
    const username = identifiers.username?.toLowerCase();
    if (email && lower.includes(email.split('@')[0])) errors.push('Cannot contain your email.');
    if (username && lower.includes(username)) errors.push('Cannot contain your username.');
  }
  return { ok: errors.length === 0, errors };
}

/* ── Hashing ───────────────────────────────────────────────────────────── */

/** Produces `salt:hashHex` matching the existing login route's expected format. */
export function hashPassword(plaintext: string): string {
  const salt = crypto.randomBytes(16).toString('hex');
  const hash = crypto.pbkdf2Sync(plaintext, salt, 100_000, 64, 'sha512').toString('hex');
  return `${salt}:${hash}`;
}

/** Verify against `salt:hashHex`. Constant-time. */
export function verifyPassword(plaintext: string, stored: string | null | undefined): boolean {
  if (!stored) return false;
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

/* ── One-time-token helpers (password reset) ───────────────────────────── */

export function generateResetToken(): { token: string; hash: string } {
  const token = crypto.randomBytes(32).toString('hex');
  const hash = crypto.createHash('sha256').update(token).digest('hex');
  return { token, hash };
}

export function hashToken(token: string): string {
  return crypto.createHash('sha256').update(token).digest('hex');
}
