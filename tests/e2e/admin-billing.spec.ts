import { expect, test } from '@playwright/test';
import { hashPassword } from '../test-utils';
import { isServerAvailable, login, skipIfOffline, waitForSettle } from './helpers';

let serverUp = false;
let tenantId = '';
let userId = '';
let roleId = '';
let subscriptionId = '';
let email = '';
let password = '';
let tenantName = '';

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
  tenantName = `E2E Billing ${uid}`;
  email = `e2e-billing-${uid.toLowerCase()}@test.example.com`;
  password = `E2EBilling${uid}!`;

  try {
    await prisma.tenant.create({
      data: {
        id: tenantId,
        name: tenantName,
        code: `E2E-BILL-${uid}`,
        domain: `billing-${uid.toLowerCase()}.example.com`,
        plan: 'ENTERPRISE',
        isActive: true,
      },
    });
    await prisma.user.create({
      data: {
        id: userId,
        email,
        username: `e2e-billing-${uid.toLowerCase()}`,
        firstName: 'Billing',
        lastName: 'E2E',
        isActive: true,
        updatedAt: new Date(),
      },
    });
    await prisma.$executeRawUnsafe(`UPDATE "User" SET password_hash = $1 WHERE id = $2`, hashPassword(password), userId);
    await prisma.role.create({
      data: {
        id: roleId,
        tenantId,
        name: 'Super Administrator',
        code: 'SUPER_ADMIN',
        isSystem: true,
      },
    });
    await prisma.userTenant.create({
      data: { id: crypto.randomUUID(), userId, tenantId, roleId, isActive: true },
    });
    const rows = await prisma.$queryRawUnsafe<Array<{ id: string }>>(
      `INSERT INTO tenant_module_subscriptions
         (tenant_id, module_code, plan_tier, billing_cycle, base_price, currency,
          max_vehicles, max_users, status, start_date, next_billing_date)
       VALUES ($1, 'RAC', 'STANDARD', 'MONTHLY', 2500, 'AED', 50, 5, 'ACTIVE', CURRENT_DATE, CURRENT_DATE + INTERVAL '30 days')
       RETURNING id::text`,
      tenantId,
    );
    subscriptionId = rows[0]?.id ?? '';
  } finally {
    await prisma.$disconnect();
  }
});

test.afterAll(async () => {
  const { PrismaClient } = await import('@prisma/client');
  const prisma = new PrismaClient();
  try {
    if (subscriptionId) await prisma.$executeRawUnsafe(`DELETE FROM tenant_module_subscriptions WHERE id = $1::uuid`, subscriptionId).catch(() => {});
    if (tenantId) {
      await prisma.userTenant.deleteMany({ where: { tenantId } });
      await prisma.role.deleteMany({ where: { tenantId } });
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

test('Admin Billing shows matching overview and subscription list rows', async ({ page }) => {
  await login(page, email, password);

  const dashboardResponse = page.waitForResponse(
    response => response.url().includes('/api/billing?type=dashboard') && response.status() === 200,
    { timeout: 60_000 },
  );
  const subscriptionsResponse = page.waitForResponse(
    response => response.url().includes('/api/tenant-subscriptions') && response.status() === 200,
    { timeout: 60_000 },
  );
  await page.goto('/admin/billing');
  await Promise.all([dashboardResponse, subscriptionsResponse]);
  await waitForSettle(page, 60_000);

  await expect(page.getByRole('heading', { name: 'Billing & Subscriptions' })).toBeVisible();
  await expect(page.getByText('RAC').first()).toBeVisible({ timeout: 45_000 });
  await expect(page.getByText(/AED\s+[1-9][0-9,]*/).first()).toBeVisible({ timeout: 45_000 });

  await page.getByRole('button', { name: 'Subscriptions' }).click();
  await expect(page.getByRole('heading', { name: 'All Subscriptions' })).toBeVisible();
  const subscriptionRow = page.locator('tr', { hasText: tenantName }).first();
  await expect(subscriptionRow).toBeVisible({ timeout: 45_000 });
  await expect(subscriptionRow.getByText('RAC')).toBeVisible();
  await expect(subscriptionRow.getByText('AED 2,500')).toBeVisible();
  await expect(page.getByText('No subscriptions yet.')).toHaveCount(0);
});

test('Admin Billing queues subscription cancellation through in-app confirmation', async ({ page }) => {
  await login(page, email, password);

  await page.goto('/admin/billing', { waitUntil: 'domcontentloaded' });
  await waitForSettle(page, 60_000);
  await page.getByRole('button', { name: 'Subscriptions' }).click();

  const subscriptionRow = page.locator('tr', { hasText: tenantName }).first();
  await expect(subscriptionRow).toBeVisible({ timeout: 45_000 });
  await subscriptionRow.getByRole('button', { name: 'Cancel' }).click();

  await expect(page.getByRole('heading', { name: 'Cancel subscription' })).toBeVisible();
  await expect(page.getByText(`${tenantName} - RAC`)).toBeVisible();

  const cancelResponse = page.waitForResponse(
    response => response.url().includes('/api/tenant-subscriptions') && response.request().method() === 'POST',
    { timeout: 60_000 },
  );
  await page.getByRole('button', { name: 'Cancel subscription' }).click();
  expect((await cancelResponse).status()).toBe(428);
  await expect(page.getByText(/Subscription cancel queued for approval/i)).toBeVisible({ timeout: 30_000 });
  await expect(page.getByRole('heading', { name: 'Cancel subscription' })).toHaveCount(0);
});
