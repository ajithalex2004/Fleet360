/**
 * Keeps test runs away from real databases.
 *
 * tests/test-utils.ts loads .env.test and then .env, and Prisma reads .env
 * itself whenever DATABASE_URL is unset. On a developer machine .env holds
 * the PRODUCTION connection strings, so any test that reached the database
 * — an integration suite, an unmocked "unit" test, the phase-0 isolation
 * runner — ran against production. That is how "Isolation Test Tenant A/B"
 * rows ended up in the production database.
 *
 * Rules, applied before anything opens a connection:
 *   - TEST_DATABASE_URL, when set, is the database tests use (DATABASE_URL,
 *     DIRECT_URL and RUNTIME_DIRECT_DATABASE_URL all point at it).
 *   - Every database variable (DATABASE_URL, DIRECT_URL, *_DATABASE_URL,
 *     DATABASE_URL_<REGION>) must be a local database: localhost, 127.0.0.1,
 *     ::1, *.localhost, or a host name without dots (a container name such
 *     as "postgres"). Anything else is replaced:
 *       DATABASE_URL, DIRECT_URL  →  UNUSABLE_TEST_DATABASE_URL (well-formed,
 *                                    so Prisma starts; connecting fails fast)
 *       the others               →  '' (unset; "skip without a database"
 *                                    checks then skip)
 *     Clearing rather than deleting matters: dotenv and Prisma never
 *     overwrite a variable that is already set.
 *   - ALLOW_REMOTE_TEST_DATABASE=1 keeps remote databases, for a dedicated
 *     test database (e.g. a Neon branch) — never the production database,
 *     which is always replaced (PROTECTED_DATABASE_HOSTS).
 *
 * Safe to import from Playwright (no vitest import).
 */

import protectedHosts from './protected-database-hosts.json';

/**
 * Neon endpoints that hold real data (production; the pooled and direct
 * endpoints both contain the id). Never used by tests. Shared with
 * scripts/run-phase0-isolation-tests.cjs through the JSON file.
 */
export const PROTECTED_DATABASE_HOSTS: readonly string[] = protectedHosts.hosts;

export const UNUSABLE_TEST_DATABASE_URL = 'postgresql://no_test_database:unset@127.0.0.1:1/no_test_database';

/** An environment: process.env, or a plain object in tests. */
type Env = Record<string, string | undefined>;

const REQUIRED_URLS = new Set(['DATABASE_URL', 'DIRECT_URL']);

function isDatabaseVar(name: string): boolean {
  return name === 'DATABASE_URL' || name === 'DIRECT_URL'
    || name.endsWith('_DATABASE_URL') || name.startsWith('DATABASE_URL_');
}

function hostOf(url: string): string {
  try {
    return new URL(url).hostname.replace(/^\[|\]$/g, '').toLowerCase();
  } catch {
    return '';
  }
}

export function isLocalDatabaseHost(host: string): boolean {
  if (!host) return false;
  return host === 'localhost' || host === '127.0.0.1' || host === '::1'
    || host.endsWith('.localhost') || !host.includes('.');
}

export function isProtectedDatabaseHost(host: string): boolean {
  return PROTECTED_DATABASE_HOSTS.some((h) => host.includes(h));
}

export interface GuardReport {
  /** Variables whose value was replaced, with the host they pointed at. */
  replaced: { name: string; host: string }[];
}

export function guardTestDatabases(env: Env = process.env): GuardReport {
  const allowRemote = env.ALLOW_REMOTE_TEST_DATABASE === '1';

  const explicit = env.TEST_DATABASE_URL?.trim();
  if (explicit) {
    const host = hostOf(explicit);
    if (isProtectedDatabaseHost(host)) {
      throw new Error(`TEST_DATABASE_URL points at the production database (${host}). Tests never run against production.`);
    }
    if (!isLocalDatabaseHost(host) && !allowRemote) {
      throw new Error(`TEST_DATABASE_URL points at a remote database (${host || 'unparseable URL'}). Use a local one, or set ALLOW_REMOTE_TEST_DATABASE=1 for a dedicated test database.`);
    }
    env.DATABASE_URL = explicit;
    env.DIRECT_URL = explicit;
    env.RUNTIME_DIRECT_DATABASE_URL = explicit;
  }

  const replaced: GuardReport['replaced'] = [];
  for (const name of Object.keys(env)) {
    if (!isDatabaseVar(name) || name === 'TEST_DATABASE_URL') continue;
    const value = env[name];
    if (!value || value === UNUSABLE_TEST_DATABASE_URL) continue;
    const host = hostOf(value);
    const keep = isLocalDatabaseHost(host) || (allowRemote && host !== '' && !isProtectedDatabaseHost(host));
    if (keep) continue;
    env[name] = REQUIRED_URLS.has(name) ? UNUSABLE_TEST_DATABASE_URL : '';
    replaced.push({ name, host: host || '(unparseable)' });
  }
  // Prisma requires both to be well-formed even when no test connects.
  for (const name of REQUIRED_URLS) {
    if (!env[name]) env[name] = UNUSABLE_TEST_DATABASE_URL;
  }
  return { replaced };
}

/** True when tests have a real (local or allowed) database to connect to. */
export function hasTestDatabase(env: Env = process.env): boolean {
  return !!env.DATABASE_URL && env.DATABASE_URL !== UNUSABLE_TEST_DATABASE_URL;
}
