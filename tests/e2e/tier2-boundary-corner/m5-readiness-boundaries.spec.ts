/**
 * Tier 2: Boundary & Corner Cases — Milestone M5: Test Readiness Boundaries
 *
 * Covers boundary, limit, and configuration checks for Feature F40 (5 tests):
 *  - F40: E2E Test Suite Boundaries
 */

import { test, expect } from '@playwright/test';
import * as fs from 'fs';
import * as path from 'path';

test.describe('F40: E2E Test Suite Boundaries & Configuration', () => {
  test('TC-F40-B01: Playwright test timeouts are configured to absorb cold starts (>60s)', () => {
    const configPath = path.resolve(process.cwd(), 'playwright.config.ts');
    const content = fs.readFileSync(configPath, 'utf8');
    expect(content).toContain('timeout: 90_000');
    expect(content).toContain('navigationTimeout: 60_000');
  });

  test('TC-F40-B02: Single worker serial execution enforced to prevent tenant data collisions', () => {
    const configPath = path.resolve(process.cwd(), 'playwright.config.ts');
    const content = fs.readFileSync(configPath, 'utf8');
    expect(content).toContain('fullyParallel: false');
    expect(content).toContain('workers: 1');
  });

  test('TC-F40-B03: Artifact retention captures only on failure to avoid disk bloat', () => {
    const configPath = path.resolve(process.cwd(), 'playwright.config.ts');
    const content = fs.readFileSync(configPath, 'utf8');
    expect(content).toContain("screenshot: 'only-on-failure'");
    expect(content).toContain("video:      'retain-on-failure'");
  });

  test('TC-F40-B04: ForbidOnly enabled in CI mode', () => {
    const configPath = path.resolve(process.cwd(), 'playwright.config.ts');
    const content = fs.readFileSync(configPath, 'utf8');
    expect(content).toContain('forbidOnly: !!process.env.CI');
  });

  test('TC-F40-B05: Base URL defaults to standard localhost port 3000 with PLAYWRIGHT_BASE_URL override', () => {
    const configPath = path.resolve(process.cwd(), 'playwright.config.ts');
    const content = fs.readFileSync(configPath, 'utf8');
    expect(content).toContain('PLAYWRIGHT_BASE_URL');
    expect(content).toContain("'http://localhost:3000'");
  });
});
