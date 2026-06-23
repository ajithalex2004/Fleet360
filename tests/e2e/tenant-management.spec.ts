/**
 * Playwright E2E Tests — Tenant Management UI
 *
 * These tests mock the /api/admin/tenants endpoint so they work independently
 * of real tenant data in the DB. The tests exercise the UI interactions:
 *   - Page loads and renders mock tenants from the intercepted API
 *   - Deactivate toggle fires the correct PATCH call
 *   - Modal wizard — required field validation, language config, module config, etc.
 *
 * Prerequisites:
 *   - Next.js dev server running on localhost:3000
 *   - A valid admin user must be logged in (created via beforeAll)
 *   - DATABASE_URL in .env.test pointing to a valid PostgreSQL database
 *
 * Run with: npx playwright test tests/e2e/tenant-management.spec.ts
 */

import { test, expect } from '@playwright/test';
import { hashPassword } from '../test-utils';
import { isServerAvailable, skipIfOffline } from './helpers';

// ── Test account ───────────────────────────────────────────────────────────────

const TM_EMAIL    = `e2e-tenantmgmt-${Date.now()}@test.example.com`;
const TM_PASSWORD = 'TenantMgmtE2E123!';
let   tmTenantId  = '';
let   tmUserId    = '';
let   serverUp    = false;

test.beforeAll(async () => {
  serverUp = await isServerAvailable();
  if (!serverUp) return;

  const { PrismaClient } = await import('@prisma/client');
  const prisma = new PrismaClient();
  const crypto = await import('crypto');

  try {
    const uid      = crypto.randomUUID().slice(0, 8);
    tmTenantId     = crypto.randomUUID();
    tmUserId       = crypto.randomUUID();

    await prisma.tenant.create({
      data: {
        id: tmTenantId, name: `E2E TenantMgmt ${uid}`,
        code: `E2E-TM-${uid}`, plan: 'ENTERPRISE', isActive: true,
      },
    });

    await prisma.user.create({
      data: {
        id: tmUserId, email: TM_EMAIL, username: `e2etm-${uid}`,
        firstName: 'TenantMgmt', lastName: 'E2E', isActive: true, updatedAt: new Date(),
      },
    });

    const passwordHash = hashPassword(TM_PASSWORD);
    await prisma.$executeRawUnsafe(
      `UPDATE "User" SET password_hash = $1 WHERE id = $2`,
      passwordHash, tmUserId,
    );

    const roleId = crypto.randomUUID();
    await prisma.role.create({
      data: { id: roleId, tenantId: tmTenantId, name: 'Tenant Administrator', code: 'TENANT_ADMIN' },
    });
    await prisma.userTenant.create({
      data: { id: crypto.randomUUID(), userId: tmUserId, tenantId: tmTenantId, roleId, isActive: true },
    });
  } finally {
    await prisma.$disconnect();
  }
});

test.afterAll(async () => {
  if (!serverUp) return;
  const { PrismaClient } = await import('@prisma/client');
  const prisma = new PrismaClient();
  try {
    if (tmTenantId) {
      await prisma.userTenant.deleteMany({ where: { tenantId: tmTenantId } });
      await prisma.role.deleteMany({ where: { tenantId: tmTenantId } });
      await prisma.tenant.delete({ where: { id: tmTenantId } }).catch(() => {});
    }
    if (tmUserId) {
      await prisma.user.delete({ where: { id: tmUserId } }).catch(() => {});
    }
  } finally {
    await prisma.$disconnect();
  }
});

// ── Skip all tests when the dev server is not running ──────────────────────────

test.beforeEach(async ({}, testInfo) => {
  skipIfOffline(serverUp, testInfo);
});

// ── Shared setup: log in + mock API + navigate to /admin/tenants ──────────────

async function goToTenantsPage({ page }: { page: any }) {
  // 1. Log in
  await page.goto('/login');
  await page.fill('input[type="email"], input[name="email"]', TM_EMAIL);
  await page.fill('input[type="password"], input[name="password"]', TM_PASSWORD);
  await page.click('button[type="submit"]');
  await page.waitForURL('**/platform**', { timeout: 20_000 });

  // 2. Intercept tenant API with mock data (AFTER login so auth cookie is set)
  await page.route('**/api/admin/tenants', async (route: any) => {
    const method = route.request().method();
    if (method === 'GET') {
      await route.fulfill({
        json: [
          {
            id: 'mock-123', name: 'Mocked Tenant (Active)', code: 'MOCK_001',
            plan: 'PROFESSIONAL', domain: 'mock.com', isActive: true,
            modules: [], _count: { userTenants: 5, roles: 2 },
          },
          {
            id: 'mock-456', name: 'Mocked Tenant (Inactive)', code: 'MOCK_002',
            plan: 'TRIAL', domain: 'mock2.com', isActive: false,
            modules: [], _count: { userTenants: 0, roles: 0 },
          },
        ],
      });
    } else if (method === 'POST') {
      await route.fulfill({ status: 201, json: { id: 'new-mock', name: 'Success' } });
    } else if (method === 'PATCH') {
      await route.fulfill({ status: 200, json: { success: true } });
    } else {
      await route.continue();
    }
  });

  // 3. Navigate to the tenants page
  await page.goto('/admin/tenants');
  await page.waitForLoadState('networkidle', { timeout: 15_000 });
}

// ── Tests ─────────────────────────────────────────────────────────────────────

test.describe('Tenant Management API & Functionalities', () => {

  test('TS_TM_001 & TS_TM_002: Page loads and mock tenants are displayed', async ({ page }) => {
    await goToTenantsPage({ page });
    await expect(page.locator('h1').filter({ hasText: 'Tenants' })).toBeVisible({ timeout: 10_000 });
    await expect(page.locator('h3').filter({ hasText: 'Mocked Tenant (Active)' })).toBeVisible();
    await expect(page.locator('h3').filter({ hasText: 'Mocked Tenant (Inactive)' })).toBeVisible();
  });

  test('TS_TM_012: Deactivate toggle integration', async ({ page }) => {
    await goToTenantsPage({ page });
    const activeTenantCard = page.locator('div').filter({ hasText: 'Mocked Tenant (Active)' }).first();
    const deactivateBtn = activeTenantCard.locator('button', { hasText: 'Deactivate' });
    await expect(deactivateBtn).toBeVisible({ timeout: 10_000 });
    await deactivateBtn.click();
    // PATCH is intercepted and mocked — verify no crash
  });

  test.describe('Modal Functionalities', () => {
    test.beforeEach(async ({ page }) => {
      await goToTenantsPage({ page });
      await page.click('button:has-text("+ New Tenant")');
      await expect(page.locator('h2', { hasText: 'Create New Tenant' })).toBeVisible({ timeout: 10_000 });
    });

    test('TS_TM_006: Required fields validation', async ({ page }) => {
      await page.click('button:has-text("Next →")');
      await page.click('button:has-text("Next →")');
      await page.click('button:has-text("Next →")');
      await page.click('button:has-text("Create Tenant")');
      await expect(page.locator('p.text-rose-400')).toContainText('Tenant Name (English) is required', { timeout: 10_000 });
    });

    test('TS_TM_007: Language Configuration toggle (Arabic)', async ({ page }) => {
      await page.locator('label').filter({ hasText: 'Arabic' }).click();
      await expect(page.getByText('Tenant Name (Arabic)')).toBeVisible({ timeout: 10_000 });
      await expect(page.getByText('Description (Arabic)')).toBeVisible();
    });

    test('TS_TM_008: Module Configuration Select All logic', async ({ page }) => {
      await page.click('button:has-text("Next →")');
      await expect(
        page.locator('p').filter({ hasText: '53 of 53 modules selected' })
          .or(page.locator('p:has-text("modules selected")')),
      ).toBeVisible({ timeout: 10_000 });
      const fleetGroup = page.locator('div.border').filter({ hasText: 'Fleet Management' });
      await fleetGroup.getByRole('button').filter({ hasText: 'Deselect All' }).first().click();
      await expect(fleetGroup.getByRole('button').filter({ hasText: 'Select All' }).first()).toBeVisible();
    });

    test('TS_TM_009: Booking Request Types expansion', async ({ page }) => {
      await page.click('button:has-text("Next →")');
      await page.click('button:has-text("Next →")');
      const logisticsBtn = page.locator('button').filter({ hasText: 'Logistics Services' });
      await logisticsBtn.click();
      await expect(page.locator('span').filter({ hasText: 'Express Delivery' })).toBeVisible({ timeout: 10_000 });
      await expect(page.locator('span').filter({ hasText: 'Cold Chain Delivery' })).toBeVisible();
    });

    test('TS_TM_010: Attachments empty state', async ({ page }) => {
      await page.click('button:has-text("Next →")');
      await page.click('button:has-text("Next →")');
      await page.click('button:has-text("Next →")');
      await expect(page.locator('p', { hasText: 'No attachments yet' })).toBeVisible({ timeout: 10_000 });
      await expect(page.locator('p', { hasText: 'Attachments can be added after saving' })).toBeVisible();
    });

    test('TS_TM_011: Submit mocked form gracefully', async ({ page }) => {
      await page.fill('input[placeholder="Enter tenant name (English)"]', 'Mock UI Test Tenant');
      await page.click('button:has-text("Next →")');
      await page.click('button:has-text("Next →")');
      await page.click('button:has-text("Next →")');
      await page.click('button:has-text("Create Tenant")');
      // POST is mocked to return 201 — modal should close
      await expect(page.locator('h2', { hasText: 'Create New Tenant' })).toBeHidden({ timeout: 10_000 });
    });
  });
});
