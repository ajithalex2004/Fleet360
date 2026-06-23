import { test, expect, type Page } from '@playwright/test';
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
let roleId = '';
let managedEmail = '';
let deleteEmail = '';
let bulkEmail = '';
let invitationEmail = '';
let createdEmail = '';
let importedEmail = '';
const createdUserIds: string[] = [];

test.describe.configure({ mode: 'serial' });

test.beforeAll(async () => {
  serverUp = await isServerAvailable();
  if (!serverUp) return;
  ctx = await createE2ETenant('Admin Users');

  const { PrismaClient } = await import('@prisma/client');
  const crypto = await import('crypto');
  const prisma = new PrismaClient();
  try {
    const role = await prisma.role.findFirstOrThrow({
      where: { tenantId: ctx.tenantId, code: 'TENANT_ADMIN' },
      select: { id: true },
    });
    roleId = role.id;

    const suffix = Date.now();
    const seedUser = async (label: string) => {
      const id = crypto.randomUUID();
      const email = `e2e-users-${label}-${suffix}@test.example.com`;
      await prisma.user.create({
        data: {
          id,
          email,
          username: `e2e-users-${label}-${suffix}`,
          firstName: label,
          lastName: 'Users',
          department: 'Operations',
          userType: 'STAFF',
          isActive: true,
          updatedAt: new Date(),
        },
      });
      await prisma.userTenant.create({
        data: { id: crypto.randomUUID(), userId: id, tenantId: ctx!.tenantId, roleId, isActive: true },
      });
      createdUserIds.push(id);
      return email;
    };

    managedEmail = await seedUser('managed');
    deleteEmail = await seedUser('delete');
    bulkEmail = await seedUser('bulk');

    await prisma.$executeRawUnsafe(`
      CREATE TABLE IF NOT EXISTS tenant_invitations (
        id                   UUID         PRIMARY KEY DEFAULT gen_random_uuid(),
        tenant_id            TEXT         NOT NULL,
        email                TEXT         NOT NULL,
        role_id              TEXT         NOT NULL,
        token_hash           TEXT         NOT NULL,
        invited_by_user_id   TEXT,
        expires_at           TIMESTAMPTZ  NOT NULL,
        used_at              TIMESTAMPTZ,
        revoked              BOOLEAN      NOT NULL DEFAULT FALSE,
        created_at           TIMESTAMPTZ  NOT NULL DEFAULT NOW()
      )
    `);
    invitationEmail = `e2e-users-invite-${suffix}@test.example.com`;
    await prisma.$executeRawUnsafe(
      `INSERT INTO tenant_invitations
         (id, tenant_id, email, role_id, token_hash, invited_by_user_id, expires_at)
       VALUES ($1::uuid,$2,$3,$4,$5,$6,NOW() + INTERVAL '7 days')`,
      crypto.randomUUID(),
      ctx.tenantId,
      invitationEmail,
      roleId,
      crypto.createHash('sha256').update(`invite-${suffix}`).digest('hex'),
      ctx.userId,
    );
  } finally {
    await prisma.$disconnect();
  }
});

test.afterAll(async () => {
  await cleanupE2ETenant(ctx);
  const { PrismaClient } = await import('@prisma/client');
  const prisma = new PrismaClient();
  try {
    const emails = [managedEmail, deleteEmail, bulkEmail, createdEmail, importedEmail].filter(Boolean);
    if (emails.length) {
      const users = await prisma.user.findMany({ where: { email: { in: emails } }, select: { id: true } });
      for (const user of users) await prisma.user.delete({ where: { id: user.id } }).catch(() => {});
    }
    for (const id of createdUserIds) await prisma.user.delete({ where: { id } }).catch(() => {});
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

async function openUsersPage(page: Page) {
  await page.goto('/admin/users', { waitUntil: 'domcontentloaded' });
  await waitForSettle(page, 45_000);
  await expect(page.getByRole('heading', { name: /User Management/i })).toBeVisible({ timeout: 60_000 });
}

function rowFor(page: Page, email: string) {
  return page.locator('tbody tr').filter({ hasText: email }).first();
}

test('ADM-USER-01: Users page persists module access and shows invitation lifecycle', async ({ page }) => {
  test.setTimeout(150_000);
  await login(page);
  await openUsersPage(page);

  await expect(page.getByText('Pending Invitations')).toBeVisible();
  await expect(page.getByText(invitationEmail)).toBeVisible({ timeout: 30_000 });

  const managedRow = rowFor(page, managedEmail);
  await expect(managedRow).toBeVisible({ timeout: 30_000 });
  await managedRow.getByRole('button', { name: 'Modules' }).click();
  await expect(page.getByRole('heading', { name: 'Module Access' })).toBeVisible();

  const driversRow = page.getByText('Drivers', { exact: true }).locator('xpath=ancestor::div[contains(@class,"rounded-xl")][1]');
  await driversRow.getByRole('button').click();
  await driversRow.locator('select').selectOption('manager');

  const rentalRow = page.getByText('Rental (RAC)', { exact: true }).locator('xpath=ancestor::div[contains(@class,"rounded-xl")][1]');
  await rentalRow.getByRole('button').click();

  const saveModules = page.waitForResponse(
    response => response.url().includes(`/api/admin/users/`) && response.request().method() === 'PATCH',
    { timeout: 60_000 },
  );
  await page.getByRole('button', { name: 'Save Access' }).click();
  expect((await saveModules).status()).toBe(200);
  await expect(page.getByRole('heading', { name: 'Module Access' })).toBeHidden({ timeout: 30_000 });
  await expect(rowFor(page, managedEmail).getByText('Drivers')).toBeVisible({ timeout: 30_000 });
  await expect(rowFor(page, managedEmail).getByText('Rental (RAC)')).toBeVisible({ timeout: 30_000 });

  await page.reload({ waitUntil: 'domcontentloaded' });
  await waitForSettle(page, 45_000);
  await expect(rowFor(page, managedEmail).getByText('Drivers')).toBeVisible({ timeout: 30_000 });
  await expect(rowFor(page, managedEmail).getByText('Rental (RAC)')).toBeVisible({ timeout: 30_000 });
});

test('ADM-USER-02: Users page creates, imports, assigns, deactivates, and soft-deletes users', async ({ page }) => {
  test.setTimeout(180_000);
  await login(page);
  await openUsersPage(page);

  const suffix = Date.now();
  createdEmail = `e2e-users-created-${suffix}@test.example.com`;
  const createResponse = page.waitForResponse(
    response => new URL(response.url()).pathname === '/api/admin/users' && response.request().method() === 'POST',
    { timeout: 60_000 },
  );
  await page.getByRole('button', { name: '+ New User' }).click();
  await page.getByPlaceholder('ahmed.mansouri').fill(`e2e-users-created-${suffix}`);
  await page.getByPlaceholder('ahmed@company.com').fill(createdEmail);
  await page.getByPlaceholder('Ahmed', { exact: true }).fill('Created');
  await page.getByPlaceholder('Al-Mansouri', { exact: true }).fill('Users');
  const createModal = page.getByRole('heading', { name: 'New User' }).locator('xpath=ancestor::div[contains(@class,"max-w-xl")][1]');
  await createModal.locator('select').nth(2).selectOption(roleId);
  await page.getByRole('button', { name: 'Create User' }).click();
  expect((await createResponse).status()).toBe(201);
  await expect(rowFor(page, createdEmail)).toBeVisible({ timeout: 30_000 });
  await expect(rowFor(page, createdEmail).getByText('Tenant Administrator')).toBeVisible({ timeout: 30_000 });

  await rowFor(page, createdEmail).getByRole('button', { name: 'Tenant' }).click();
  await expect(page.getByRole('heading', { name: 'Assign to Tenant' })).toBeVisible();
  await page.getByRole('button', { name: 'Cancel' }).click();

  importedEmail = `e2e-users-imported-${suffix}@test.example.com`;
  const importResponse = page.waitForResponse(
    response => response.url().includes('/api/admin/users/bulk') && response.request().method() === 'POST',
    { timeout: 60_000 },
  );
  await page.getByRole('button', { name: 'Import' }).click();
  await page.locator('select').filter({ hasText: 'Select role' }).selectOption(roleId);
  await page.locator('textarea').fill(`email,username,firstName,lastName,department,position\n${importedEmail},e2e-users-imported-${suffix},Imported,Users,Operations,Operator`);
  await page.getByRole('button', { name: 'Import Users' }).click();
  expect((await importResponse).status()).toBe(200);
  await expect(rowFor(page, importedEmail)).toBeVisible({ timeout: 30_000 });

  const deleteResponse = page.waitForResponse(
    response => response.url().includes('/api/admin/users/') && response.request().method() === 'DELETE',
    { timeout: 60_000 },
  );
  await rowFor(page, deleteEmail).getByRole('button', { name: 'Delete' }).click();
  await expect(page.getByRole('heading', { name: 'Delete User' })).toBeVisible();
  await page.getByRole('button', { name: 'Delete user' }).click();
  expect((await deleteResponse).status()).toBe(200);
  await expect(rowFor(page, deleteEmail)).toBeHidden({ timeout: 30_000 });

  await rowFor(page, bulkEmail).locator('input[type="checkbox"]').check();
  await page.getByRole('button', { name: 'Deactivate 1' }).click();
  await expect(page.getByRole('heading', { name: 'Deactivate Users' })).toBeVisible();
  const bulkResponse = page.waitForResponse(
    response => response.url().includes('/api/admin/users/bulk') && response.request().method() === 'POST',
    { timeout: 60_000 },
  );
  await page.getByRole('button', { name: 'Deactivate users' }).click();
  expect((await bulkResponse).status()).toBe(200);
  await expect(rowFor(page, bulkEmail)).toBeHidden({ timeout: 30_000 });

  await page.locator('select').filter({ hasText: 'Inactive / Deleted' }).selectOption('false');
  await waitForSettle(page, 45_000);
  await expect(rowFor(page, deleteEmail)).toBeVisible({ timeout: 30_000 });
  await expect(rowFor(page, bulkEmail)).toBeVisible({ timeout: 30_000 });
});
