/**
 * tests/unit/test-db-guard.test.ts
 *
 * Test runs used to load .env, which on a developer machine points at the
 * PRODUCTION database; integration suites and the phase-0 runner wrote test
 * tenants there. tests/db-guard.ts now replaces every non-local database
 * setting before anything connects.
 */
import { describe, it, expect } from 'vitest';
import {
  guardTestDatabases, hasTestDatabase, isLocalDatabaseHost, UNUSABLE_TEST_DATABASE_URL,
} from '../db-guard';

const PROD_POOLED = 'postgresql://fleet360_app:secret@ep-calm-heart-a15voo2a-pooler.ap-southeast-1.aws.neon.tech/neondb?sslmode=require';
const PROD_DIRECT = 'postgresql://neondb_owner:secret@ep-calm-heart-a15voo2a.ap-southeast-1.aws.neon.tech/neondb';
const OTHER_NEON = 'postgresql://u:p@ep-test-branch-123.ap-southeast-1.aws.neon.tech/test';
const LOCAL = 'postgresql://postgres:test@127.0.0.1:5432/fleet360_test';

describe('guardTestDatabases', () => {
  it('replaces the production settings .env provides', () => {
    const env: Record<string, string | undefined> = {
      DATABASE_URL: PROD_POOLED, DIRECT_URL: PROD_DIRECT, MIGRATION_DATABASE_URL: PROD_DIRECT,
      PHASE0_DATABASE_URL: PROD_POOLED, RUNTIME_DIRECT_DATABASE_URL: PROD_DIRECT, DATABASE_URL_EU: PROD_POOLED,
    };
    const report = guardTestDatabases(env);
    expect(env.DATABASE_URL).toBe(UNUSABLE_TEST_DATABASE_URL);
    expect(env.DIRECT_URL).toBe(UNUSABLE_TEST_DATABASE_URL);
    // Cleared, not deleted: dotenv and Prisma never overwrite a set variable.
    expect(env.MIGRATION_DATABASE_URL).toBe('');
    expect(env.PHASE0_DATABASE_URL).toBe('');
    expect(env.RUNTIME_DIRECT_DATABASE_URL).toBe('');
    expect(env.DATABASE_URL_EU).toBe('');
    expect('MIGRATION_DATABASE_URL' in env).toBe(true);
    expect(report.replaced.map((r) => r.name).sort()).toEqual([
      'DATABASE_URL', 'DATABASE_URL_EU', 'DIRECT_URL', 'MIGRATION_DATABASE_URL', 'PHASE0_DATABASE_URL', 'RUNTIME_DIRECT_DATABASE_URL',
    ]);
    expect(hasTestDatabase(env)).toBe(false);
  });

  it('keeps local databases', () => {
    const env: Record<string, string | undefined> = { DATABASE_URL: LOCAL, DIRECT_URL: 'postgresql://p@localhost/x', TEST_RIDER_DATABASE_URL: 'postgresql://p@postgres:5432/x' };
    expect(guardTestDatabases(env).replaced).toEqual([]);
    expect(env.DATABASE_URL).toBe(LOCAL);
    expect(hasTestDatabase(env)).toBe(true);
  });

  it('uses TEST_DATABASE_URL for DATABASE_URL, DIRECT_URL and the runtime direct URL', () => {
    const env: Record<string, string | undefined> = { TEST_DATABASE_URL: LOCAL, DATABASE_URL: PROD_POOLED, DIRECT_URL: PROD_DIRECT };
    guardTestDatabases(env);
    expect([env.DATABASE_URL, env.DIRECT_URL, env.RUNTIME_DIRECT_DATABASE_URL]).toEqual([LOCAL, LOCAL, LOCAL]);
  });

  it('refuses a remote TEST_DATABASE_URL without the opt-in, and production always', () => {
    expect(() => guardTestDatabases({ TEST_DATABASE_URL: OTHER_NEON })).toThrow(/remote database/);
    expect(() => guardTestDatabases({ TEST_DATABASE_URL: PROD_POOLED, ALLOW_REMOTE_TEST_DATABASE: '1' })).toThrow(/production/);
  });

  it('keeps a dedicated remote database on opt-in, but never production', () => {
    const env: Record<string, string | undefined> = { ALLOW_REMOTE_TEST_DATABASE: '1', DATABASE_URL: OTHER_NEON, DIRECT_URL: PROD_DIRECT };
    guardTestDatabases(env);
    expect(env.DATABASE_URL).toBe(OTHER_NEON);
    expect(env.DIRECT_URL).toBe(UNUSABLE_TEST_DATABASE_URL);
  });

  it('always leaves DATABASE_URL and DIRECT_URL well-formed for Prisma', () => {
    const env: Record<string, string | undefined> = {};
    guardTestDatabases(env);
    expect(env.DATABASE_URL).toBe(UNUSABLE_TEST_DATABASE_URL);
    expect(env.DIRECT_URL).toBe(UNUSABLE_TEST_DATABASE_URL);
  });

  it('treats localhost, loopback, *.localhost and container names as local', () => {
    expect(['localhost', '127.0.0.1', '::1', 'db.localhost', 'postgres'].every(isLocalDatabaseHost)).toBe(true);
    expect(['ep-x.aws.neon.tech', '10.0.0.5', ''].some(isLocalDatabaseHost)).toBe(false);
  });
});

describe('this test run', () => {
  it('is not connected to the production database', () => {
    for (const [name, value] of Object.entries(process.env)) {
      if (/^(DATABASE_URL|DIRECT_URL)$|_DATABASE_URL$|^DATABASE_URL_/.test(name)) {
        expect(value ?? '', name).not.toContain('ep-calm-heart-a15voo2a');
      }
    }
  });
});
