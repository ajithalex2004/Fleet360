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
import { guardTestDatabases } from './db-guard';

// Load env so DATABASE_URL is available when this module is imported standalone.
// Order matters: .env.test first (test overrides), then .env with override=true
// so the dev server's actual values (e.g. SESSION_SECRET) win. This is critical
// for integration tests that hit the running dev server — the test must sign
// session cookies with the SAME secret the server uses to verify them.
dotenv.config({ path: '.env.test' });
dotenv.config({ path: '.env' });

// USE_STAGING_DB=true runs the suites against STAGING_DATABASE_URL — a
// remote database, so it needs the explicit opt-in below.
if (process.env.USE_STAGING_DB === 'true') {
  if (!process.env.STAGING_DATABASE_URL) {
    throw new Error(
      'USE_STAGING_DB is set but STAGING_DATABASE_URL is not. Set it in your ' +
        'environment (e.g. .env.test, which is gitignored) — there is no ' +
        'built-in staging connection string.'
    );
  }
  process.env.TEST_DATABASE_URL = process.env.STAGING_DATABASE_URL;
}

// Never the databases .env points at: see tests/db-guard.ts.
const guard = guardTestDatabases();
if (guard.replaced.length > 0 && !process.env.__FLEET360_DB_GUARD_REPORTED) {
  process.env.__FLEET360_DB_GUARD_REPORTED = '1';
  console.warn(
    `[test db-guard] ignoring non-local database settings (${guard.replaced.map((r) => `${r.name} → ${r.host}`).join(', ')}). `
      + 'Tests that need a database are skipped or fail fast; set TEST_DATABASE_URL to a local database to run them.',
  );
}

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
