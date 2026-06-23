import { test, expect, type Page } from '@playwright/test';
import { hashPassword } from '../test-utils';
import { isServerAvailable, skipIfOffline, waitForSettle } from './helpers';

let serverUp = false;
let adminTenantId = '';
let adminUserId = '';
let adminEmail = '';
let adminPassword = '';
let targetTenantId = '';
let targetTenantName = '';
let createdTenantId = '';
let createdTenantName = '';

test.describe.configure({ mode: 'serial' });

test.beforeAll(async () => {
  serverUp = await isServerAvailable();
  if (!serverUp) return;

  const { PrismaClient } = await import('@prisma/client');
  const crypto = await import('crypto');
  const prisma = new PrismaClient();
  try {
    const suffix = crypto.randomUUID().slice(0, 8).toUpperCase();
    adminTenantId = crypto.randomUUID();
    adminUserId = crypto.randomUUID();
    adminEmail = `e2e-admin-tenants-${suffix.toLowerCase()}@test.example.com`;
    adminPassword = `E2ETenants${suffix}!`;

    await prisma.tenant.create({
      data: { id: adminTenantId, name: `E2E Admin Tenants ${suffix}`, code: `E2E-AT-${suffix}`, plan: 'ENTERPRISE', isActive: true },
    });
    await prisma.user.create({
      data: {
        id: adminUserId,
        email: adminEmail,
        username: `e2e-admin-tenants-${suffix.toLowerCase()}`,
        firstName: 'Admin',
        lastName: 'Tenants E2E',
        isActive: true,
        updatedAt: new Date(),
      },
    });
    await prisma.$executeRawUnsafe(`UPDATE "User" SET password_hash = $1 WHERE id = $2`, hashPassword(adminPassword), adminUserId);
    const roleId = crypto.randomUUID();
    await prisma.role.create({ data: { id: roleId, tenantId: adminTenantId, name: 'Super Administrator', code: 'SUPER_ADMIN' } });
    await prisma.userTenant.create({ data: { id: crypto.randomUUID(), userId: adminUserId, tenantId: adminTenantId, roleId, isActive: true } });

    targetTenantId = crypto.randomUUID();
    targetTenantName = `E2E Tenant Detail ${suffix}`;
    await prisma.tenant.create({
      data: {
        id: targetTenantId,
        name: targetTenantName,
        code: `E2E-TD-${suffix}`,
        plan: 'PROFESSIONAL',
        contactEmail: `tenant-detail-${suffix.toLowerCase()}@test.example.com`,
        isActive: true,
      },
    });
    await prisma.tenantModule.createMany({
      data: [
        { tenantId: targetTenantId, module: 'fleet', isEnabled: true },
        { tenantId: targetTenantId, module: 'rac', isEnabled: true },
      ],
    });
    await prisma.role.create({
      data: { id: crypto.randomUUID(), tenantId: targetTenantId, name: 'Tenant Administrator', code: 'TENANT_ADMIN' },
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
    for (const tenantId of [createdTenantId, targetTenantId, adminTenantId].filter(Boolean)) {
      await prisma.$executeRawUnsafe(`DELETE FROM admin_change_history WHERE tenant_id = $1`, tenantId).catch(() => {});
      await prisma.$executeRawUnsafe(`DELETE FROM audit_logs WHERE tenant_id = $1`, tenantId).catch(() => {});
      await prisma.$executeRawUnsafe(`DELETE FROM admin_approval_requests WHERE tenant_id = $1`, tenantId).catch(() => {});
      await prisma.tenantModule.deleteMany({ where: { tenantId } }).catch(() => {});
      await prisma.userTenant.deleteMany({ where: { tenantId } }).catch(() => {});
      await prisma.role.deleteMany({ where: { tenantId } }).catch(() => {});
      await prisma.tenant.delete({ where: { id: tenantId } }).catch(() => {});
    }
    if (adminUserId) await prisma.user.delete({ where: { id: adminUserId } }).catch(() => {});
  } finally {
    await prisma.$disconnect();
  }
});

test.beforeEach(async ({}, testInfo) => {
  skipIfOffline(serverUp, testInfo);
});

async function login(page: Page) {
  const loginRes = await page.request.post('/api/auth/login', {
    data: { email: adminEmail, password: adminPassword, tenantId: adminTenantId },
    timeout: 60_000,
  });
  expect(loginRes.ok()).toBeTruthy();
}

async function openTenantsPage(page: Page) {
  await page.goto('/admin/tenants', { waitUntil: 'domcontentloaded' });
  await waitForSettle(page, 45_000);
  await page.getByText('Loading tenants').waitFor({ state: 'hidden', timeout: 60_000 }).catch(() => {});
  await expect(page.getByRole('heading', { name: 'Tenants', exact: true })).toBeVisible({ timeout: 60_000 });
}

function tenantCard(page: Page, tenantName: string) {
  return page.getByTestId('tenant-card').filter({ hasText: tenantName }).first();
}

test('ADM-TEN-01: Tenants page creates a tenant and shows canonical module chips', async ({ page }) => {
  test.setTimeout(180_000);
  await login(page);
  await openTenantsPage(page);

  const suffix = Date.now();
  createdTenantName = `E2E Created Tenant ${suffix}`;
  const createResponse = page.waitForResponse(
    response => new URL(response.url()).pathname === '/api/admin/tenants' && response.request().method() === 'POST',
    { timeout: 90_000 },
  );

  await page.getByRole('button', { name: '+ New Tenant' }).click();
  await expect(page.getByRole('heading', { name: 'Create New Tenant' })).toBeVisible();
  await page.getByPlaceholder('e.g. BT001, CABMAN_01').fill(`E2E-CT-${suffix}`);
  await page.getByPlaceholder('Enter tenant name (English)').fill(createdTenantName);
  await page.getByPlaceholder('info@company.com').fill(`created-tenant-${suffix}@test.example.com`);
  await page.locator('button').filter({ hasText: 'Next' }).first().click();
  await page.locator('button').filter({ hasText: 'Next' }).first().click();
  await page.locator('button').filter({ hasText: 'Next' }).first().click();
  await page.getByRole('button', { name: 'Create Tenant' }).click();

  const response = await createResponse;
  expect(response.status()).toBe(201);
  const body = await response.json();
  createdTenantId = body.id;

  await expect(page.getByRole('heading', { name: 'Create New Tenant' })).toBeHidden({ timeout: 30_000 });
  await openTenantsPage(page);
  await expect(tenantCard(page, createdTenantName)).toBeVisible({ timeout: 60_000 });
  await expect(tenantCard(page, createdTenantName).getByText('Vehicle Leasing')).toBeVisible();
  await expect(tenantCard(page, createdTenantName).getByText('Staff Transport')).toBeVisible();
});

test('ADM-TEN-02: Tenant detail shows module state and queues dangerous module changes', async ({ page }) => {
  test.setTimeout(150_000);
  await login(page);
  await page.goto(`/admin/tenants/${targetTenantId}`, { waitUntil: 'domcontentloaded' });
  await waitForSettle(page, 60_000);

  await expect(page.getByRole('heading', { name: targetTenantName })).toBeVisible({ timeout: 60_000 });
  await expect(page.getByRole('button', { name: 'Tenant 360', exact: true })).toHaveClass(/border-blue-500/);
  await expect(page.getByRole('heading', { name: 'Tenant Readiness' })).toBeVisible();
  await expect(page.getByText('Enabled Modules')).toBeVisible();

  await page.getByRole('button', { name: 'Module Access', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Module Access', exact: true })).toHaveClass(/border-blue-500/);
  await expect(page.getByText('Fleet Management')).toBeVisible();
  await expect(page.getByText('Rent-a-Car')).toBeVisible();

  const driversTile = page.getByText('Driver Management').locator('xpath=ancestor::label[1]');
  await driversTile.click();
  const saveResponse = page.waitForResponse(
    response => response.url().includes(`/api/admin/tenants/${targetTenantId}/modules`) && response.request().method() === 'PUT',
    { timeout: 90_000 },
  );
  await page.getByRole('button', { name: 'Save Module Access' }).click();
  expect((await saveResponse).status()).toBe(428);
  await expect(page.getByText(/Module access update queued for approval/i)).toBeVisible({ timeout: 30_000 });
});

test('ADM-TEN-03: Tenant status changes are approval-gated from the tenant list', async ({ page }) => {
  test.setTimeout(150_000);
  await login(page);
  await openTenantsPage(page);

  const card = tenantCard(page, targetTenantName);
  await expect(card).toBeVisible({ timeout: 60_000 });
  const statusResponse = page.waitForResponse(
    response => response.url().includes(`/api/admin/tenants/${targetTenantId}`) && response.request().method() === 'PATCH',
    { timeout: 90_000 },
  );
  await card.getByRole('button', { name: 'Deactivate' }).click();
  expect((await statusResponse).status()).toBe(428);
  await expect(page.getByText(/Tenant status change queued for approval/i)).toBeVisible({ timeout: 30_000 });
});
