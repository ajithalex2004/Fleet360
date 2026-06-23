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
import * as fs from 'fs';

// Load env so DATABASE_URL is available when this module is imported standalone
dotenv.config({ path: '.env.test' });
dotenv.config({ path: '.env' });

const projectEnv = fs.existsSync('.env') ? fs.readFileSync('.env', 'utf8') : '';
if (!/^SESSION_SECRET=/m.test(projectEnv)) {
  process.env.SESSION_SECRET = 'xl-mobility-dev-secret-change-in-production';
}

// Web Crypto polyfill (Node < 20)
if (typeof globalThis.crypto === 'undefined' || !globalThis.crypto.subtle) {
  Object.defineProperty(globalThis, 'crypto', {
    value: crypto.webcrypto,
    configurable: true,
  });
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
