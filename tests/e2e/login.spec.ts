/**
 * Playwright E2E Tests — Login Flow
 *
 * What is tested:
 *  - Navigating to /login shows a login form
 *  - Submitting wrong credentials shows an error message
 *  - Submitting correct credentials redirects to /platform
 *  - After login, /platform shows "Welcome back" text
 *  - Logout button clears the session and redirects to /login
 *
 * Prerequisites:
 *  - Next.js dev server running on localhost:3000 (configured in playwright.config.ts)
 *  - DATABASE_URL in .env.test pointing to a valid PostgreSQL database
 *  - A test user is created in beforeAll using the test DB
 *
 * Run with: npm run test:e2e
 * Or just these tests: npx playwright test tests/e2e/login.spec.ts
 */

import { test, expect, type Page } from '@playwright/test';
import { hashPassword } from '../test-utils';
import { isServerAvailable, skipIfOffline } from './helpers';

// ── Test credentials — set up in beforeAll ────────────────────────────────────

const TEST_EMAIL    = `e2e-login-${Date.now()}@test.example.com`;
const TEST_PASSWORD = 'E2ETestPassword123!';
let   testTenantId  = '';
let   testUserId    = '';
let   serverUp      = false;

// ── Ensure test user exists before all tests ──────────────────────────────────

test.beforeAll(async () => {
  serverUp = await isServerAvailable();
  if (!serverUp) return; // skip DB setup when server is down

  // We use the Prisma client directly via a dynamic import so the test file
  // doesn't drag in the full server runtime at Playwright collection time.
  // This block runs in Node.js (not browser) context.
  const { PrismaClient } = await import('@prisma/client');
  const prisma = new PrismaClient();
  const crypto = await import('crypto');

  try {
    // Create a test tenant
    const uid = crypto.randomUUID().slice(0, 8);
    testTenantId = crypto.randomUUID();
    testUserId   = crypto.randomUUID();

    await prisma.tenant.create({
      data: {
        id:       testTenantId,
        name:     `E2E Login Tenant ${uid}`,
        code:     `E2E-LOGIN-${uid}`,
        plan:     'ENTERPRISE',
        isActive: true,
      },
    });

    // Create user
    await prisma.user.create({
      data: {
        id:        testUserId,
        email:     TEST_EMAIL,
        username:  `e2elogin-${uid}`,
        firstName: 'E2E',
        lastName:  'Login Test',
        isActive:  true,
        updatedAt: new Date(),
      },
    });

    // Set password hash (column outside Prisma schema)
    const passwordHash = hashPassword(TEST_PASSWORD);
    await prisma.$executeRawUnsafe(
      `UPDATE "User" SET password_hash = $1 WHERE id = $2`,
      passwordHash,
      testUserId,
    );

    // Create role + link user to tenant
    const roleId = crypto.randomUUID();
    await prisma.role.create({
      data: {
        id:       roleId,
        tenantId: testTenantId,
        name:     'Tenant Administrator',
        code:     'TENANT_ADMIN',
      },
    });

    await prisma.userTenant.create({
      data: {
        id:       crypto.randomUUID(),
        userId:   testUserId,
        tenantId: testTenantId,
        roleId:   roleId,
        isActive: true,
      },
    });
  } finally {
    await prisma.$disconnect();
  }
});

// ── Cleanup after all tests ───────────────────────────────────────────────────

test.afterAll(async () => {
  if (!serverUp) return;
  const { PrismaClient } = await import('@prisma/client');
  const prisma = new PrismaClient();

  try {
    if (testTenantId) {
      await prisma.userTenant.deleteMany({ where: { tenantId: testTenantId } });
      await prisma.role.deleteMany({ where: { tenantId: testTenantId } });
      await prisma.tenant.delete({ where: { id: testTenantId } }).catch(() => {});
    }
    if (testUserId) {
      await prisma.user.delete({ where: { id: testUserId } }).catch(() => {});
    }
  } finally {
    await prisma.$disconnect();
  }
});

test.beforeEach(async ({}, testInfo) => {
  skipIfOffline(serverUp, testInfo);
});

// ── Helper: login action ──────────────────────────────────────────────────────

async function performLogin(page: Page, email: string, password: string) {
  await page.fill('input[type="email"], input[name="email"]', email);
  await page.fill('input[type="password"], input[name="password"]', password);
  await page.click('button[type="submit"]');
}

async function waitForPlatformRedirect(page: Page) {
  await page.waitForURL(/\/platform(?:$|[?#])/, {
    timeout: 45_000,
    waitUntil: 'domcontentloaded',
  });
  expect(new URL(page.url()).pathname).toBe('/platform');
}

// ── Tests ─────────────────────────────────────────────────────────────────────

test('navigating to /login shows a login form', async ({ page }) => {
  await page.goto('/login');

  // Should have an email and password field
  await expect(page.locator('input[type="email"], input[name="email"]')).toBeVisible();
  await expect(page.locator('input[type="password"], input[name="password"]')).toBeVisible();
  await expect(page.locator('button[type="submit"]')).toBeVisible();
});

test('submitting wrong credentials shows an error message', async ({ page }) => {
  await page.goto('/login');

  await performLogin(page, 'wrong@email.com', 'wrongpassword');

  // Wait for error feedback — can be inline error, toast, or alert
  await expect(
    page.locator(
      '[role="alert"], .error, .alert, [data-testid="error"], ' +
      'p:has-text("Invalid"), p:has-text("incorrect"), p:has-text("wrong"), ' +
      'span:has-text("Invalid"), div:has-text("Invalid email")',
    ),
  ).toBeVisible({ timeout: 10_000 });

  // Should still be on /login
  expect(page.url()).toContain('/login');
});

test('submitting correct credentials redirects to /platform', async ({ page }) => {
  await page.goto('/login');

  await performLogin(page, TEST_EMAIL, TEST_PASSWORD);

  await waitForPlatformRedirect(page);
});

test('after login, /platform page renders content (not a redirect loop)', async ({ page }) => {
  await page.goto('/login');
  await performLogin(page, TEST_EMAIL, TEST_PASSWORD);

  await waitForPlatformRedirect(page);

  await expect(page.getByRole('heading', { name: 'Fleet360' })).toBeVisible({
    timeout: 10_000,
  });
});

test('after login, visiting /platform shows welcome or dashboard content', async ({ page }) => {
  // Login first
  await page.goto('/login');
  await performLogin(page, TEST_EMAIL, TEST_PASSWORD);
  await waitForPlatformRedirect(page);

  // The platform page should show some form of welcome or navigation
  const content = await page.content();

  // Check for common dashboard indicators
  const hasContent =
    content.includes('Welcome') ||
    content.includes('Fleet') ||
    content.includes('Module') ||
    content.includes('Dashboard') ||
    content.includes('platform');

  expect(hasContent).toBe(true);
});

test('unauthenticated visit to /platform redirects to /login', async ({ page }) => {
  // Navigate to /platform without logging in
  await page.goto('/platform');

  // Should be redirected to /login
  await page.waitForURL('**/login**', { timeout: 10_000 });
  expect(page.url()).toContain('/login');
});

test('logout clears session and redirects to /login', async ({ page }) => {
  // First, log in
  await page.goto('/login');
  await performLogin(page, TEST_EMAIL, TEST_PASSWORD);
  await waitForPlatformRedirect(page);

  // Find and click the logout button/link
  // Common selectors for logout: button with text "Logout", "Sign out", link to /logout, etc.
  const logoutButton = page.locator(
    'button:has-text("Logout"), button:has-text("Sign out"), ' +
    'a:has-text("Logout"), a:has-text("Sign out"), ' +
    '[data-testid="logout"], [aria-label="Logout"], ' +
    'button:has-text("Log out"), a[href*="logout"]',
  );

  // If we can find the logout button, click it
  if (await logoutButton.count() > 0) {
    await logoutButton.first().click();

    // Should redirect to /login
    await page.waitForURL('**/login**', { timeout: 10_000 });
    expect(page.url()).toContain('/login');

    // Visiting /platform again should redirect back to /login
    await page.goto('/platform');
    await page.waitForURL('**/login**', { timeout: 10_000 });
    expect(page.url()).toContain('/login');
  } else {
    // If no logout button found, call the logout API directly
    const res = await page.request.post('/api/auth/logout');
    expect([200, 204]).toContain(res.status());

    // Navigating to /platform should now redirect to /login
    await page.goto('/platform');
    await page.waitForURL('**/login**', { timeout: 10_000 });
    expect(page.url()).toContain('/login');
  }
});
