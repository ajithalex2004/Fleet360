import { expect, test, type Page } from '@playwright/test';
import { hashPassword } from '../test-utils';
import {
  cleanupE2ETenant,
  createE2ETenant,
  isServerAvailable,
  skipIfOffline,
  waitForSettle,
  type E2EContext,
} from './helpers';

let serverUp = false;
let ctx: E2EContext | null = null;
let foreignTenantId = '';
let foreignUserId = '';

test.beforeAll(async () => {
  serverUp = await isServerAvailable();
  if (!serverUp) return;
  ctx = await createE2ETenant('Admin Overview');

  const { PrismaClient } = await import('@prisma/client');
  const crypto = await import('crypto');
  const prisma = new PrismaClient();
  const uid = crypto.randomUUID().slice(0, 8).toUpperCase();
  foreignTenantId = crypto.randomUUID();
  foreignUserId = crypto.randomUUID();
  const foreignRoleId = crypto.randomUUID();

  try {
    await prisma.tenant.create({
      data: {
        id: foreignTenantId,
        name: `E2E Overview Foreign ${uid}`,
        code: `E2E-OVR-F-${uid}`,
        plan: 'ENTERPRISE',
        isActive: true,
      },
    });
    await prisma.user.create({
      data: {
        id: foreignUserId,
        email: `e2e-overview-foreign-${uid.toLowerCase()}@test.example.com`,
        username: `e2e-overview-foreign-${uid.toLowerCase()}`,
        firstName: 'Foreign',
        lastName: 'Overview',
        isActive: true,
        updatedAt: new Date(),
      },
    });
    await prisma.$executeRawUnsafe(`UPDATE "User" SET password_hash = $1 WHERE id = $2`, hashPassword(`Foreign${uid}!`), foreignUserId);
    await prisma.role.create({
      data: { id: foreignRoleId, tenantId: foreignTenantId, name: 'Tenant Administrator', code: 'TENANT_ADMIN' },
    });
    await prisma.userTenant.create({
      data: { id: crypto.randomUUID(), userId: foreignUserId, tenantId: foreignTenantId, roleId: foreignRoleId, isActive: true },
    });
  } finally {
    await prisma.$disconnect();
  }
});

test.afterAll(async () => {
  await cleanupE2ETenant(ctx);
  const { PrismaClient } = await import('@prisma/client');
  const prisma = new PrismaClient();
  try {
    if (foreignTenantId) {
      await prisma.userTenant.deleteMany({ where: { tenantId: foreignTenantId } }).catch(() => {});
      await prisma.role.deleteMany({ where: { tenantId: foreignTenantId } }).catch(() => {});
      await prisma.tenant.delete({ where: { id: foreignTenantId } }).catch(() => {});
    }
    if (foreignUserId) await prisma.user.delete({ where: { id: foreignUserId } }).catch(() => {});
  } finally {
    await prisma.$disconnect();
  }
});

test.beforeEach(async ({}, testInfo) => {
  skipIfOffline(serverUp, testInfo);
});

async function login(page: Page) {
  const loginRes = await page.request.post('/api/auth/login', {
    data: { email: ctx!.email, password: ctx!.password, tenantId: ctx!.tenantId },
    timeout: 60_000,
  });
  expect(loginRes.ok()).toBeTruthy();
}

async function apiJson(page: Page, path: string) {
  const response = await page.request.get(path, { timeout: 60_000 });
  expect(response.ok(), `${path} status`).toBeTruthy();
  return response.json();
}

async function cardValue(page: Page, key: string) {
  const text = await page.getByTestId(`overview-card-${key}`).locator('.text-4xl').innerText({ timeout: 60_000 });
  return Number(text.replace(/\D/g, ''));
}

test('ADM-OVR-01: Overview cards match tenant-scoped source APIs and quick links work', async ({ page }) => {
  test.setTimeout(180_000);
  await login(page);

  const overview = await apiJson(page, '/api/admin/overview');
  const expected = overview.stats;
  expect(expected.tenants).toBe(1);

  await page.goto('/admin', { waitUntil: 'domcontentloaded' });
  await waitForSettle(page, 60_000);
  await expect(page.getByRole('heading', { name: 'Platform Administration' })).toBeVisible({ timeout: 60_000 });

  await expect(page.getByText('Seed UAE Leasing Demo Data')).toHaveCount(0);
  await expect(page.getByText('Admin control plane online')).toBeVisible();
  await expect(await cardValue(page, 'tenants')).toBe(expected.tenants);
  await expect(await cardValue(page, 'users')).toBe(expected.users);
  await expect(await cardValue(page, 'roles')).toBe(expected.roles);
  await expect(await cardValue(page, 'permissions')).toBe(expected.permissions);

  await page.getByTestId('overview-card-users').click();
  await expect(page).toHaveURL(/\/admin\/users/);
  await expect(page.getByRole('heading', { name: /User Management/i })).toBeVisible({ timeout: 60_000 });
});

test('ADM-OVR-02: Overview surfaces source API failures instead of silently showing zeroes', async ({ page }) => {
  test.setTimeout(120_000);
  await login(page);
  await page.route('**/api/admin/overview', route => route.fulfill({
    status: 500,
    contentType: 'application/json',
    body: JSON.stringify({ error: 'Synthetic overview API failure' }),
  }));

  await page.goto('/admin', { waitUntil: 'domcontentloaded' });
  await expect(page.getByRole('alert').filter({ hasText: 'Synthetic overview API failure' })).toBeVisible({ timeout: 60_000 });
});
