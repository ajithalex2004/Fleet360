import { describe, it, expect } from 'vitest';
import { execSync } from 'child_process';
import path from 'path';
import fs from 'fs';
import os from 'os';

describe('Static Credential Leak Guard (check-no-hardcoded-credentials.mjs)', () => {
  it('passes on the clean repository codebase', () => {
    const result = execSync('node scripts/check-no-hardcoded-credentials.mjs', {
      encoding: 'utf8',
      cwd: process.cwd(),
    });
    expect(result).toContain('Credential check passed');
  });

  it('fails fast and flags files containing real npg_ tokens', () => {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'cred-test-'));
    const dummyScript = path.join(tmpDir, 'test-scanner.mjs');
    
    // Copy the script logic and run against a temporary folder with a violation
    const scannerCode = fs.readFileSync(path.resolve('scripts/check-no-hardcoded-credentials.mjs'), 'utf8');
    // Replace SCAN_DIRS with tmpDir
    const modifiedScanner = scannerCode.replace(
      /const SCAN_DIRS = \[.*?\];/s,
      `const SCAN_DIRS = [${JSON.stringify(tmpDir)}];`
    ).replace(
      /const SCAN_FILES = \[.*?\];/s,
      `const SCAN_FILES = [];`
    );

    fs.writeFileSync(dummyScript, modifiedScanner, 'utf8');

    const violationFile = path.join(tmpDir, 'leaked.txt');
    const sampleCred = ['postgres', 'ql://user:n', 'pg_SecretPass123456@host.neon.tech/db'].join('');
    fs.writeFileSync(violationFile, `DATABASE_URL="${sampleCred}"`, 'utf8');

    let errorThrown = false;
    let stdout = '';
    try {
      execSync(`node "${dummyScript}"`, { encoding: 'utf8', stdio: 'pipe' });
    } catch (err: any) {
      errorThrown = true;
      stdout = err.stdout?.toString() || err.stderr?.toString() || '';
    } finally {
      fs.rmSync(tmpDir, { recursive: true, force: true });
    }

    expect(errorThrown).toBe(true);
    expect(stdout).toContain('CRITICAL SECURITY ERROR');
    expect(stdout).toContain('Neon password token');
  });
});
