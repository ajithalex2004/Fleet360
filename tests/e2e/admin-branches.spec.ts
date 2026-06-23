import { expect, test, type Page } from '@playwright/test';
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
let createdBranchId = '';

test.describe.configure({ mode: 'serial' });

test.beforeAll(async () => {
  serverUp = await isServerAvailable();
  if (!serverUp) return;
  ctx = await createE2ETenant('Admin Branches');

  const { PrismaClient } = await import('@prisma/client');
  const crypto = await import('crypto');
  const prisma = new PrismaClient();
  const uid = crypto.randomUUID().slice(0, 8).toUpperCase();
  foreignTenantId = crypto.randomUUID();
  try {
    await prisma.tenant.create({
      data: {
        id: foreignTenantId,
        name: `E2E Branch Foreign ${uid}`,
        code: `E2E-BRF-${uid}`,
        plan: 'ENTERPRISE',
        isActive: true,
      },
    });
  } finally {
    await prisma.$disconnect();
  }
});

test.afterAll(async () => {
  const { PrismaClient } = await import('@prisma/client');
  const prisma = new PrismaClient();
  try {
    if (ctx?.tenantId) {
      await prisma.$executeRawUnsafe(`DELETE FROM admin_change_history WHERE tenant_id = $1`, ctx.tenantId).catch(() => {});
      await prisma.$executeRawUnsafe(`DELETE FROM audit_logs WHERE tenant_id = $1`, ctx.tenantId).catch(() => {});
      await prisma.$executeRawUnsafe(`DELETE FROM tenant_branches WHERE tenant_id = $1`, ctx.tenantId).catch(() => {});
    }
    if (foreignTenantId) {
      await prisma.$executeRawUnsafe(`DELETE FROM tenant_branches WHERE tenant_id = $1`, foreignTenantId).catch(() => {});
      await prisma.tenant.delete({ where: { id: foreignTenantId } }).catch(() => {});
    }
  } finally {
    await prisma.$disconnect();
  }
  await cleanupE2ETenant(ctx);
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

async function openBranchesPage(page: Page) {
  await page.goto('/admin/branches', { waitUntil: 'domcontentloaded' });
  await waitForSettle(page, 60_000);
  await page.getByText('Loading branches').waitFor({ state: 'hidden', timeout: 60_000 }).catch(() => {});
  await expect(page.getByRole('heading', { name: 'Branch Management' })).toBeVisible({ timeout: 60_000 });
}

function rowFor(page: Page, branchName: string) {
  return page.locator('tbody tr').filter({ hasText: branchName }).first();
}

test('ADM-BR-01: Branch lifecycle saves, reloads, deletes, and writes audit/change history', async ({ page }) => {
  test.setTimeout(240_000);
  await login(page);
  await openBranchesPage(page);

  const suffix = Date.now();
  const branchName = `E2E Dubai Branch ${suffix}`;
  const editedName = `E2E Abu Dhabi Branch ${suffix}`;
  const createResponse = page.waitForResponse(
    response => new URL(response.url()).pathname === '/api/tenant-branches' && response.request().method() === 'POST',
    { timeout: 90_000 },
  );

  await page.getByRole('button', { name: '+ Add Branch', exact: true }).click();
  const createModal = page.getByRole('heading', { name: 'Add New Branch' }).locator('xpath=ancestor::div[contains(@class,"max-w-2xl")][1]');
  await createModal.locator('select').first().selectOption(ctx!.tenantId);
  await createModal.getByPlaceholder('Abu Dhabi Branch').fill(branchName);
  await createModal.locator('select').nth(1).selectOption('DUBAI');
  await createModal.getByPlaceholder('CN-1234567').fill(`TL-${suffix}`);
  await createModal.locator('input[type="date"]').fill('2030-12-31');
  await createModal.getByPlaceholder('CC-AUH / CC-DXB').fill(`CC-${suffix}`);
  await createModal.getByPlaceholder('ops@branch.ae').fill(`branch-${suffix}@test.example.com`);
  await createModal.getByRole('button', { name: 'Create Branch' }).click();
  const createBody = await (await createResponse).json();
  createdBranchId = createBody.id;
  expect(createdBranchId).toBeTruthy();

  await expect(rowFor(page, branchName)).toBeVisible({ timeout: 60_000 });
  await expect(rowFor(page, branchName).getByText(`TL-${suffix}`)).toBeVisible();

  await page.reload({ waitUntil: 'domcontentloaded' });
  await waitForSettle(page, 60_000);
  await expect(rowFor(page, branchName)).toBeVisible({ timeout: 60_000 });

  const editResponse = page.waitForResponse(
    response => new URL(response.url()).pathname === '/api/tenant-branches' && response.request().method() === 'PATCH',
    { timeout: 90_000 },
  );
  await rowFor(page, branchName).getByRole('button', { name: 'Edit' }).click();
  const editModal = page.getByRole('heading', { name: 'Edit Branch' }).locator('xpath=ancestor::div[contains(@class,"max-w-2xl")][1]');
  await editModal.getByPlaceholder('Abu Dhabi Branch').fill(editedName);
  await editModal.locator('select').nth(1).selectOption('ABU_DHABI');
  await editModal.getByPlaceholder('CC-AUH / CC-DXB').fill(`CC-EDIT-${suffix}`);
  await editModal.getByRole('button', { name: 'Save Changes' }).click();
  expect((await editResponse).status()).toBe(200);
  await expect(rowFor(page, editedName)).toBeVisible({ timeout: 60_000 });
  await expect(rowFor(page, editedName).getByText(`CC-EDIT-${suffix}`)).toBeVisible();

  const deleteResponse = page.waitForResponse(
    response => new URL(response.url()).pathname === '/api/tenant-branches' && response.request().method() === 'DELETE',
    { timeout: 90_000 },
  );
  await rowFor(page, editedName).getByRole('button', { name: /Delete/ }).click();
  await expect(page.getByRole('heading', { name: 'Delete Branch' })).toBeVisible();
  await page.getByRole('button', { name: /Delete Branch/ }).click();
  expect((await deleteResponse).status()).toBe(200);
  await expect(rowFor(page, editedName)).toBeHidden({ timeout: 60_000 });

  const { PrismaClient } = await import('@prisma/client');
  const prisma = new PrismaClient();
  try {
    const changes = await prisma.$queryRawUnsafe<Array<{ action: string; summary: string | null }>>(
      `SELECT action, summary
         FROM admin_change_history
        WHERE entity_type = 'Branch' AND entity_id = $1
        ORDER BY created_at ASC`,
      createdBranchId,
    );
    expect(changes.map(c => c.action)).toEqual(expect.arrayContaining(['CREATE', 'UPDATE', 'DELETE']));
    expect(changes.some(c => c.summary?.includes(editedName))).toBe(true);

    const audits = await prisma.$queryRawUnsafe<Array<{ action: string }>>(
      `SELECT action FROM audit_logs WHERE entity_type = 'Branch' AND entity_id = $1`,
      createdBranchId,
    );
    expect(audits.map(a => a.action)).toEqual(expect.arrayContaining(['CREATE', 'UPDATE', 'DELETE']));
  } finally {
    await prisma.$disconnect();
  }
});

test('ADM-BR-02: Tenant admin cannot read or mutate another tenant branches', async ({ page }) => {
  test.setTimeout(120_000);
  await login(page);

  const read = await page.request.get(`/api/tenant-branches?tenantId=${foreignTenantId}`, { timeout: 60_000 });
  expect(read.status()).toBe(403);

  const create = await page.request.post('/api/tenant-branches', {
    data: {
      tenantId: foreignTenantId,
      branchName: `Forbidden Branch ${Date.now()}`,
      emirate: 'DUBAI',
    },
    timeout: 60_000,
  });
  expect(create.status()).toBe(403);
});

test('ADM-BR-03: Branch page surfaces API failures', async ({ page }) => {
  test.setTimeout(120_000);
  await login(page);
  await page.route('**/api/tenant-branches**', route => route.fulfill({
    status: 500,
    contentType: 'application/json',
    body: JSON.stringify({ error: 'Synthetic branch API failure' }),
  }));

  await page.goto('/admin/branches', { waitUntil: 'domcontentloaded' });
  await expect(page.getByRole('alert').filter({ hasText: 'Synthetic branch API failure' })).toBeVisible({ timeout: 60_000 });
});
