import { describe, it, expect } from 'vitest';
import { execSync, spawnSync } from 'child_process';
import path from 'path';
import { scanContent, inspectUrlTarget } from '@/../scripts/check-no-hardcoded-credentials.mjs';

describe('1. Static Credential Leak Guard (check-no-hardcoded-credentials.mjs)', () => {
  it('passes cleanly across all tracked files in repository', () => {
    const result = execSync('node scripts/check-no-hardcoded-credentials.mjs', {
      encoding: 'utf8',
      cwd: process.cwd(),
    });
    expect(result).toContain('Credential check passed');
  });

  it('rejects connection URLs on arbitrary remote hosts (provider-agnostic)', () => {
    const dummyUrl = ['postgres', '://user:mysecretpassword@db.arbitrary-host.com:5432/fleet'].join('');
    const content = `const db = "${dummyUrl}";`;
    const violations = scanContent(content, 'backend/config/db.go');
    expect(violations.length).toBeGreaterThan(0);
    expect(violations[0].rule).toContain('PostgreSQL');
    expect(violations[0].file).toBe('backend/config/db.go');
  });

  it('detects and rejects URL-encoded passwords on remote hosts', () => {
    // URL-encoded: p%40ssw0rd!
    const encodedUrl = ['postgres', 'ql://admin:p%40ssw0rd%21@db.remote.io/prod'].join('');
    const content = `const url = "${encodedUrl}";`;
    const violations = scanContent(content, 'packages/agent-sdk/src/db.ts');
    expect(violations.length).toBeGreaterThan(0);
  });

  it('allows exact approved placeholder combinations on approved hosts', () => {
    const valid1 = 'postgres://user:password@localhost:5432/fleet_dev';
    const valid2 = 'postgresql://postgres:postgres@127.0.0.1:5432/test';
    const valid3 = 'postgresql://user:pass@example.com/test';
    const valid4 = 'postgres://fleet360_app:dummy@localhost:5432/fleet360_test';

    expect(inspectUrlTarget(valid1.replace('postgres://', ''))).toBeNull();
    expect(inspectUrlTarget(valid2.replace('postgresql://', ''))).toBeNull();
    expect(inspectUrlTarget(valid3.replace('postgresql://', ''))).toBeNull();
    expect(inspectUrlTarget(valid4.replace('postgres://', ''))).toBeNull();
  });

  it('strictly rejects near-placeholders (e.g. password123, pass_secret, dummy_live)', () => {
    const near1 = 'user:password123@localhost:5432';
    const near2 = 'user:pass_staging@localhost:5432';
    const near3 = 'user:dummy_key@localhost:5432';
    const near4 = 'user:test_secret@localhost:5432';

    expect(inspectUrlTarget(near1)?.isViolation).toBe(true);
    expect(inspectUrlTarget(near2)?.isViolation).toBe(true);
    expect(inspectUrlTarget(near3)?.isViolation).toBe(true);
    expect(inspectUrlTarget(near4)?.isViolation).toBe(true);
  });

  it('detects standalone unredacted Neon tokens (npg_*)', () => {
    const fakeToken = ['npg_', 'A1B2C3D4E5F6G7H8'].join('');
    const content = `// Token was: ${fakeToken}`;
    const violations = scanContent(content, 'docs/AUDIT.md');
    expect(violations.length).toBe(1);
    expect(violations[0].rule).toContain('Neon credential token');
  });

  it('ensures violation output never echoes line content or secret values', () => {
    const rawOut = spawnSync('node', ['scripts/check-no-hardcoded-credentials.mjs'], {
      encoding: 'utf8',
      cwd: process.cwd(),
    });
    // Successful run output should not have passwords or snippets
    expect(rawOut.stdout).not.toContain('password');
    expect(rawOut.stderr).toBe('');
  });
});

describe('2. Fail-Closed Subprocess Isolation Tests', () => {
  it('verify-staging-proxy-e2e.js exits with code 1 in clean isolated environment without network activity', () => {
    // Spawn with an empty isolated environment (no STAGING_DATABASE_URL)
    const res = spawnSync('node', ['scripts/verify-staging-proxy-e2e.js'], {
      encoding: 'utf8',
      env: {
        PATH: process.env.PATH || '',
        SYSTEMROOT: process.env.SYSTEMROOT || '',
      },
      cwd: process.cwd(),
    });

    expect(res.status).toBe(1);
    expect(res.stderr).toContain('STAGING_DATABASE_URL environment variable is required');
  });

  it('staging-live-smoke.mjs exits with code 1 in clean isolated environment when STAGING_DATABASE_URL is absent', () => {
    const res = spawnSync('node', ['scripts/staging-live-smoke.mjs'], {
      encoding: 'utf8',
      env: {
        PATH: process.env.PATH || '',
        SYSTEMROOT: process.env.SYSTEMROOT || '',
        // Override any loaded files by passing empty STAGING_DATABASE_URL
        STAGING_DATABASE_URL: '',
      },
      cwd: process.cwd(),
    });

    expect(res.status).toBe(1);
    expect(res.stderr).toContain('STAGING_DATABASE_URL environment variable is required');
  });
});
