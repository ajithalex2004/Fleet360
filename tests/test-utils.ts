/**
 * Vitest-free test utilities — safe to import from Playwright E2E specs.
 *
 * DO NOT add any import from 'vitest' here.
 * This file is shared between:
 *   - tests/setup.ts  (Vitest integration tests)
 *   - tests/e2e/**    (Playwright E2E tests)
 */

import * as crypto from 'crypto';
import * as dotenv from 'dotenv';

// Load env so DATABASE_URL is available when this module is imported standalone.
// Order matters: .env.test first (test overrides), then .env with override=true
// so the dev server's actual values (e.g. SESSION_SECRET) win. This is critical
// for integration tests that hit the running dev server — the test must sign
// session cookies with the SAME secret the server uses to verify them.
dotenv.config({ path: '.env.test' });
dotenv.config({ path: '.env' });

// Web Crypto polyfill (Node < 20)
if (typeof globalThis.crypto === 'undefined' || !globalThis.crypto.subtle) {
  globalThis.crypto = (crypto as any).webcrypto;
}

/**
 * Hashes a plaintext password with PBKDF2-SHA512 + random salt.
 * Format: "<salt_hex>:<hash_hex>"
 * Matches verifyPassword() in /api/auth/login.
 */
export function hashPassword(plaintext: string): string {
  const salt = crypto.randomBytes(16).toString('hex');
  const hash = crypto
    .pbkdf2Sync(plaintext, salt, 100_000, 64, 'sha512')
    .toString('hex');
  return `${salt}:${hash}`;
}
