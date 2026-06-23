import { expect, test, type Page } from '@playwright/test';
import { hashPassword } from '../test-utils';
import { isServerAvailable, skipIfOffline, waitForSettle } from './helpers';

let serverUp = false;
let tenantId = '';
let userId = '';
let roleId = '';
let email = '';
let password = '';

test.beforeAll(async () => {
  serverUp = await isServerAvailable();
  if (!serverUp) return;

  const { PrismaClient } = await import('@prisma/client');
  const crypto = await import('crypto');
  const prisma = new PrismaClient();
  const uid = crypto.randomUUID().slice(0, 8).toUpperCase();

  tenantId = crypto.randomUUID();
  userId = crypto.randomUUID();
  roleId = crypto.randomUUID();
  email = `e2e-settings-${uid.toLowerCase()}@test.example.com`;
  password = `E2ESettings${uid}!`;

  try {
    await prisma.tenant.create({
      data: {
        id: tenantId,
        name: `E2E Settings ${uid}`,
        code: `E2E-SET-${uid}`,
        plan: 'ENTERPRISE',
        isActive: true,
      },
    });
    await prisma.user.create({
      data: {
        id: userId,
        email,
        username: `e2e-settings-${uid.toLowerCase()}`,
        firstName: 'Settings',
        lastName: 'E2E',
        isActive: true,
        updatedAt: new Date(),
      },
    });
    await prisma.$executeRawUnsafe(`UPDATE "User" SET password_hash = $1 WHERE id = $2`, hashPassword(password), userId);
    await prisma.role.create({
      data: { id: roleId, tenantId, name: 'Super Administrator', code: 'SUPER_ADMIN', isSystem: true },
    });
    await prisma.userTenant.create({
      data: { id: crypto.randomUUID(), userId, tenantId, roleId, isActive: true },
    });
  } catch (error) {
    console.warn('[admin-settings.spec] setup skipped because database is unavailable:', error);
    serverUp = false;
  } finally {
    await prisma.$disconnect();
  }
});

test.afterAll(async () => {
  if (!serverUp) return;
  const { PrismaClient } = await import('@prisma/client');
  const prisma = new PrismaClient();
  try {
    await prisma.$executeRawUnsafe(`DELETE FROM admin_approval_requests WHERE requested_by = $1`, userId).catch(() => {});
    if (tenantId) {
      await prisma.userTenant.deleteMany({ where: { tenantId } }).catch(() => {});
      await prisma.role.deleteMany({ where: { tenantId } }).catch(() => {});
      await prisma.tenant.delete({ where: { id: tenantId } }).catch(() => {});
    }
    if (userId) await prisma.user.delete({ where: { id: userId } }).catch(() => {});
  } finally {
    await prisma.$disconnect();
  }
});

test.beforeEach(async ({}, testInfo) => {
  skipIfOffline(serverUp, testInfo);
});

async function login(page: Page) {
  let lastStatus = 0;
  for (let attempt = 1; attempt <= 3; attempt++) {
    const loginRes = await page.request.post('/api/auth/login', {
      data: { email, password, tenantId },
      timeout: 60_000,
    });
    lastStatus = loginRes.status();
    if (loginRes.ok()) return;
    await page.waitForTimeout(3_000 * attempt);
  }
  expect(lastStatus, 'login response status').toBe(200);
}

async function waitForSettingsPage(page: Page, heading: string, loadingText: string) {
  await expect(page.getByRole('heading', { name: heading })).toBeVisible({ timeout: 60_000 });
  await page.getByText(loadingText).waitFor({ state: 'hidden', timeout: 120_000 }).catch(() => {});
}

test('Admin Settings queues platform changes and uses in-app reset confirmation', async ({ page }) => {
  test.setTimeout(180_000);
  await login(page);
  await page.goto('/admin/settings', { waitUntil: 'domcontentloaded' });
  await waitForSettle(page, 60_000);

  await waitForSettingsPage(page, 'Platform Settings', 'Loading settings...');
  await expect(page.locator('select').first()).toBeVisible({ timeout: 60_000 });
  await page.locator('select').first().selectOption('UTC');

  const saveResponse = page.waitForResponse(
    response => response.url().includes('/api/admin/platform-settings') && response.request().method() === 'PATCH',
    { timeout: 60_000 },
  );
  await page.getByRole('button', { name: /Save Changes/ }).click();
  expect((await saveResponse).status()).toBe(428);
  await expect(page.getByText(/Settings update queued for approval/i)).toBeVisible({ timeout: 30_000 });

  await page.getByRole('button', { name: /Reset Defaults/ }).click();
  await expect(page.getByRole('heading', { name: 'Reset settings view?' })).toBeVisible();
  await page.getByRole('button', { name: 'Cancel' }).click();
  await expect(page.getByRole('heading', { name: 'Reset settings view?' })).toHaveCount(0);
});

test('Notification channel test surfaces provider failures', async ({ page }) => {
  test.setTimeout(180_000);
  await login(page);
  await page.goto('/admin/settings/notifications', { waitUntil: 'domcontentloaded' });
  await waitForSettle(page, 60_000);

  await waitForSettingsPage(page, 'Notification Channels', 'Loading channel settings...');
  await page.locator('select').first().selectOption('none');
  const testResponse = page.waitForResponse(
    response => response.url().includes('/api/admin/test-channel') && response.request().method() === 'POST',
    { timeout: 60_000 },
  );
  await page.getByRole('button', { name: /Send Test Email/ }).click();
  expect((await testResponse).status()).toBe(400);
  await expect(page.getByText(/Email provider is set to "none"/i)).toBeVisible({ timeout: 30_000 });
});

test('Integrations save queues dangerous configuration changes', async ({ page }) => {
  test.setTimeout(180_000);
  await login(page);
  await page.goto('/admin/settings/integrations', { waitUntil: 'domcontentloaded' });
  await waitForSettle(page, 60_000);

  await waitForSettingsPage(page, 'Integrations & ERP', 'Loading integrations...');
  await page.getByPlaceholder('e.g. Zapier, Make, Custom API').fill('E2E Webhook');
  await page.getByPlaceholder('https://your-system.com/webhook').fill('https://example.test/webhook');

  const saveResponse = page.waitForResponse(
    response => response.url().includes('/api/integration-configs') && response.request().method() === 'POST',
    { timeout: 60_000 },
  );
  await page.getByRole('button', { name: 'Save Configuration' }).first().click();
  expect((await saveResponse).status()).toBe(428);
  await expect(page.getByText(/Queued for approval/i)).toBeVisible({ timeout: 30_000 });
});
