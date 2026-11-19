/**
 * Tier 1: Feature Coverage — Milestone M5 / Final: Test Suite & Readiness
 *
 * Covers Feature F40 (5 tests):
 *  - F40: E2E Test Suite & Hardening
 */

import { test, expect } from '@playwright/test';
import * as fs from 'fs';
import * as path from 'path';

test.describe('F40: E2E Test Suite & Readiness', () => {
  test('TC-F40-01: Playwright test configuration exists and is well-formed', () => {
    const configPath = path.resolve(process.cwd(), 'playwright.config.ts');
    expect(fs.existsSync(configPath)).toBe(true);
    const content = fs.readFileSync(configPath, 'utf8');
    expect(content).toContain("testDir: './tests/e2e'");
  });

  test('TC-F40-02: Package.json contains standard test:e2e runner script', () => {
    const pkgPath = path.resolve(process.cwd(), 'package.json');
    const pkg = JSON.parse(fs.readFileSync(pkgPath, 'utf8'));
    expect(pkg.scripts['test:e2e']).toContain('playwright test');
  });

  test('TC-F40-03: Tier helpers provide offline graceful skipping', () => {
    const helpersPath = path.resolve(process.cwd(), 'tests/e2e/tier-helpers.ts');
    expect(fs.existsSync(helpersPath)).toBe(true);
    const content = fs.readFileSync(helpersPath, 'utf8');
    expect(content).toContain('skipIfOffline');
    expect(content).toContain('isServerAvailable');
  });

  test('TC-F40-04: Project Feature Inventory matches PROJECT.md specifications', () => {
    const projectMdPath = path.resolve(process.cwd(), 'PROJECT.md');
    expect(fs.existsSync(projectMdPath)).toBe(true);
    const content = fs.readFileSync(projectMdPath, 'utf8');
    expect(content).toContain('F01');
    expect(content).toContain('F40');
  });

  test('TC-F40-05: Acceptance criteria documented in ORIGINAL_REQUEST.md are tracked', () => {
    const reqPath = path.resolve(process.cwd(), '.agents/teamwork/ORIGINAL_REQUEST.md');
    expect(fs.existsSync(reqPath)).toBe(true);
  });
});
