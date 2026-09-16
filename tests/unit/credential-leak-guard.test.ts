import { describe, it, expect } from 'vitest';
import { execSync, spawnSync, type SpawnSyncOptionsWithStringEncoding } from 'child_process';
import fs from 'fs';
import os from 'os';
import path from 'path';
import { scanContent, inspectPostgresUri } from '../../scripts/check-no-hardcoded-credentials.mjs';

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

  it('detects and rejects query-string embedded passwords (?password=...)', () => {
    const queryUrl = ['postgresql', '://service_user@db.internal:5432/fleet?sslmode=require&password=my_query_secret'].join('');
    const content = `const uri = "${queryUrl}";`;
    const violations = scanContent(content, 'scripts/connect.ts');
    expect(violations.length).toBe(1);
    expect(violations[0].rule).toContain('PostgreSQL');
  });

  it('handles IPv6 connection URIs correctly', () => {
    // Approved placeholder on IPv6 loopback
    const loopbackIpv6Placeholder = 'postgresql://user:pass@[::1]:5432/test';
    expect(inspectPostgresUri(loopbackIpv6Placeholder)).toBeNull();

    // Disallowed password on IPv6 loopback
    const loopbackIpv6RealPass = ['postgresql', '://user:unapproved_secret@[::1]:5432/test'].join('');
    expect(inspectPostgresUri(loopbackIpv6RealPass)?.isViolation).toBe(true);

    // Remote IPv6 host
    const remoteIpv6 = ['postgresql', '://user:password@[2001:db8::1]:5432/test'].join('');
    expect(inspectPostgresUri(remoteIpv6)?.isViolation).toBe(true);
  });

  it('allows exact approved placeholder combinations on approved hosts', () => {
    const valid1 = 'postgres://user:password@localhost:5432/fleet_dev';
    const valid2 = 'postgresql://postgres:postgres@127.0.0.1:5432/test';
    const valid3 = 'postgresql://user:pass@example.com/test';
    const valid4 = 'postgres://fleet360_app:dummy@localhost:5432/fleet360_test';

    expect(inspectPostgresUri(valid1)).toBeNull();
    expect(inspectPostgresUri(valid2)).toBeNull();
    expect(inspectPostgresUri(valid3)).toBeNull();
    expect(inspectPostgresUri(valid4)).toBeNull();
  });

  it('strictly rejects near-placeholders (e.g. password123, pass_staging, dummy_live)', () => {
    const near1 = ['postgres', 'ql://user:password123@localhost:5432/db'].join('');
    const near2 = ['postgres', 'ql://user:pass_staging@localhost:5432/db'].join('');
    const near3 = ['postgres', 'ql://user:dummy_key@localhost:5432/db'].join('');
    const near4 = ['postgres', 'ql://user:test_secret@localhost:5432/db'].join('');

    expect(inspectPostgresUri(near1)?.isViolation).toBe(true);
    expect(inspectPostgresUri(near2)?.isViolation).toBe(true);
    expect(inspectPostgresUri(near3)?.isViolation).toBe(true);
    expect(inspectPostgresUri(near4)?.isViolation).toBe(true);
  });

  it('detects standalone unredacted Neon tokens (npg_*)', () => {
    const fakeToken = ['npg_', 'A1B2C3D4E5F6G7H8'].join('');
    const content = `// Token was: ${fakeToken}`;
    const violations = scanContent(content, 'docs/AUDIT.md');
    expect(violations.length).toBe(1);
    expect(violations[0].rule).toContain('Neon credential token');
  });

  it('ensures violation output NEVER echoes line content or secret values on synthetic violation', () => {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'sec-scan-'));
    const testFile = path.join(tmpDir, 'violation.ts');
    const syntheticSecret = 'super_synthetic_secret_xyz999';
    const violationUri = ['postgres', `ql://myuser:${syntheticSecret}@db.remote.io:5432/fleet`].join('');
    fs.writeFileSync(
      testFile,
      `const secretDb = "${violationUri}";\n`,
      'utf8'
    );

    try {
      const violations = scanContent(fs.readFileSync(testFile, 'utf8'), 'test/violation.ts');
      expect(violations.length).toBe(1);

      // Verify that the violation object contains only safe metadata
      const v = violations[0];
      expect(v).toHaveProperty('file');
      expect(v).toHaveProperty('line');
      expect(v).toHaveProperty('rule');
      expect(v).not.toHaveProperty('preview');
      expect(v).not.toHaveProperty('snippet');
      expect(JSON.stringify(v)).not.toContain(syntheticSecret);
    } finally {
      fs.rmSync(tmpDir, { recursive: true, force: true });
    }
  });
});

describe('2. Fail-Closed Subprocess Isolation Tests', () => {
  it('verify-staging-proxy-e2e.js exits with code 1 in clean isolated environment without network activity', () => {
    const spawnOptions: SpawnSyncOptionsWithStringEncoding = {
      encoding: 'utf8',
      env: {
        NODE_ENV: 'test',
        PATH: process.env.PATH || '',
        SYSTEMROOT: process.env.SYSTEMROOT || '',
        // Point STAGING_APP_ORIGIN to an unreachable endpoint; if any network call occurred it would timeout/fail
        STAGING_APP_ORIGIN: 'http://127.0.0.1:59999',
      },
      cwd: process.cwd(),
      timeout: 3000,
    };

    const startTime = Date.now();
    const res = spawnSync('node', ['scripts/verify-staging-proxy-e2e.js'], spawnOptions);
    const duration = Date.now() - startTime;

    expect(res.status).toBe(1);
    expect(res.stderr).toContain('STAGING_DATABASE_URL environment variable is required');
    // Must exit immediately during module initialization before any network operation
    expect(duration).toBeLessThan(2000);
  });

  it('staging-live-smoke.mjs exits with code 1 in clean isolated environment when STAGING_DATABASE_URL is absent', () => {
    const spawnOptions: SpawnSyncOptionsWithStringEncoding = {
      encoding: 'utf8',
      env: {
        NODE_ENV: 'test',
        PATH: process.env.PATH || '',
        SYSTEMROOT: process.env.SYSTEMROOT || '',
        STAGING_URL: 'http://127.0.0.1:59999',
        STAGING_DATABASE_URL: '',
      },
      cwd: process.cwd(),
      timeout: 3000,
    };

    const startTime = Date.now();
    const res = spawnSync('node', ['scripts/staging-live-smoke.mjs'], spawnOptions);
    const duration = Date.now() - startTime;

    expect(res.status).toBe(1);
    expect(res.stderr).toContain('STAGING_DATABASE_URL environment variable is required');
    expect(duration).toBeLessThan(2000);
  });
});
