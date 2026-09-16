/**
 * Central source for the secret(s) that sign and verify session tokens,
 * SSO state cookies, and the SSO client-secret encryption key.
 *
 * Fails loudly when unconfigured or weak rather than falling back to a shared,
 * publicly-known default: an unset, too-short, whitespace, or placeholder secret
 * must break the request, not silently accept (or sign with) a string that ships
 * in this repo. Mirrors backend/auth/jwt.go's secret() on the Go side,
 * which applies the same "crash beats a hard-coded fallback" rule.
 */

const MIN_SECRET_LENGTH = 32;

/** Known dummy/placeholder substrings that must never be used in any environment. */
const BANNED_SUBSTRINGS = [
  'change-in-production',
  'change-me',
  'changeme',
  'placeholder',
  'default-secret',
  'dummy-secret',
  'xl-mobility-dev-secret',
  'fleet360-dev-secret',
  'example-secret',
  'password123',
];

let warnedSsoCoupling = false;

/**
 * Validates that a secret string meets enterprise security criteria:
 * 1. Non-empty after trimming.
 * 2. At least MIN_SECRET_LENGTH (32) characters.
 * 3. Does not contain known placeholder / dummy phrases.
 * 4. Sufficient character variety (at least 6 distinct characters).
 */
export function validateSecret(name: string, rawValue: string | undefined | null): string {
  if (!rawValue) {
    throw new Error(
      `No ${name} configured. Set ${name} (32+ random characters) in the environment — there is no fallback default.`
    );
  }

  const trimmed = rawValue.trim();
  if (!trimmed) {
    throw new Error(
      `${name} cannot be empty or whitespace only. Set a cryptographically random secret of at least ${MIN_SECRET_LENGTH} characters.`
    );
  }

  if (trimmed.length < MIN_SECRET_LENGTH) {
    throw new Error(
      `${name} must be at least ${MIN_SECRET_LENGTH} characters (got ${trimmed.length}).`
    );
  }

  const lower = trimmed.toLowerCase();
  for (const banned of BANNED_SUBSTRINGS) {
    if (lower.includes(banned)) {
      throw new Error(
        `${name} contains forbidden insecure placeholder pattern "${banned}". Generate a fresh high-entropy random secret.`
      );
    }
  }

  const distinctChars = new Set(trimmed).size;
  if (distinctChars < 6) {
    throw new Error(
      `${name} has insufficient entropy (only ${distinctChars} distinct characters). Generate a cryptographically random secret.`
    );
  }

  return trimmed;
}

/**
 * Returns the configured session secret (SESSION_SECRET, or one of the
 * legacy env-var aliases below for back-compat). Throws if none is set,
 * if whitespace-only, if too short (< 32 chars), or if a known placeholder.
 */
export function requireSessionSecret(): string {
  const raw =
    process.env.SESSION_SECRET ||
    process.env.AUTH_SECRET ||
    process.env.JWT_SECRET ||
    process.env.NEXTAUTH_SECRET;

  return validateSecret('SESSION_SECRET', raw);
}

/**
 * Returns the key used to encrypt SSO client secrets at rest.
 *
 * Dedicated key (SSO_ENCRYPTION_KEY) is validated with the same strict criteria.
 * If unset, falls back to SESSION_SECRET with an operational warning in production,
 * documenting that rotating SESSION_SECRET will decouple existing encrypted SSO credentials unless re-encrypted.
 */
export function requireSsoEncryptionSecret(): string {
  const dedicated = process.env.SSO_ENCRYPTION_KEY;
  if (dedicated) {
    return validateSecret('SSO_ENCRYPTION_KEY', dedicated);
  }

  if (process.env.NODE_ENV === 'production' && !warnedSsoCoupling) {
    console.warn(
      '[security] SSO_ENCRYPTION_KEY is unset; falling back to SESSION_SECRET for at-rest encryption. ' +
        'Warning: rotating SESSION_SECRET will decouple existing encrypted SSO credentials unless re-encrypted.'
    );
    warnedSsoCoupling = true;
  }

  return requireSessionSecret();
}

