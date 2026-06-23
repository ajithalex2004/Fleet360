import { test, expect } from '@playwright/test';
import type { PrismaClient } from '@prisma/client';
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
let extraUserId = '';
let roleId = '';
let roleCode = '';
let compareRoleId = '';
let createRoleCode = '';
const permissionIds: string[] = [];

test.describe.configure({ mode: 'serial' });

async function createPermission(prisma: PrismaClient, module: string, action: string, resource = '*') {
  const crypto = await import('crypto');
  const rows = await prisma.$queryRawUnsafe<Array<{ id: string }>>(
    `INSERT INTO permissions (id, module, action, resource, label, description)
     VALUES ($1,$2,$3,$4,$5,$6)
     ON CONFLICT (module, action, resource)
     DO UPDATE SET label = EXCLUDED.label
     RETURNING id`,
    crypto.randomUUID(),
    module,
    action,
    resource,
    `${module}:${action}:${resource}`,
    'E2E roles permission',
  );
  return rows[0].id;
}

test.beforeAll(async () => {
  serverUp = await isServerAvailable();
  if (!serverUp) return;
  ctx = await createE2ETenant('Admin Roles');

  const { PrismaClient } = await import('@prisma/client');
  const crypto = await import('crypto');
  const prisma = new PrismaClient();
  try {
    const viewPerm = await createPermission(prisma, 'fleet', 'view', 'roles_e2e');
    const editPerm = await createPermission(prisma, 'fleet', 'edit', 'roles_e2e');
    permissionIds.push(viewPerm, editPerm);

    roleId = crypto.randomUUID();
    roleCode = `E2E_ROLES_OPERATOR_${Date.now()}`;
    await prisma.role.create({
      data: {
        id: roleId,
        tenantId: ctx.tenantId,
        name: 'E2E Roles Operator',
        code: roleCode,
        description: 'Role for Admin Roles browser coverage',
        isSystem: false,
        permissions: { create: [{ permissionId: viewPerm }] },
      },
    });
    compareRoleId = crypto.randomUUID();
    await prisma.role.create({
      data: {
        id: compareRoleId,
        tenantId: ctx.tenantId,
        name: 'E2E Roles Comparator',
        code: `E2E_ROLES_COMPARATOR_${Date.now()}`,
        description: 'Comparison target for Admin Roles browser coverage',
        isSystem: false,
        permissions: { create: [{ permissionId: editPerm }] },
      },
    });

    extraUserId = crypto.randomUUID();
    await prisma.user.create({
      data: {
        id: extraUserId,
        email: `e2e-roles-user-${Date.now()}@test.example.com`,
        username: `e2e-roles-user-${Date.now()}`,
        firstName: 'Roles',
        lastName: 'Preview',
        isActive: true,
        updatedAt: new Date(),
      },
    });
    await prisma.userTenant.create({
      data: {
        id: crypto.randomUUID(),
        userId: extraUserId,
        tenantId: ctx.tenantId,
        roleId,
        isActive: true,
      },
    });
  } finally {
    await prisma.$disconnect();
  }
});

async function login(page: import('@playwright/test').Page) {
  const loginRes = await page.request.post('/api/auth/login', {
    data: { email: ctx!.email, password: ctx!.password, tenantId: ctx!.tenantId },
    timeout: 60_000,
  });
  expect(loginRes.ok()).toBeTruthy();
}

async function openRolesPage(page: import('@playwright/test').Page) {
  await page.goto('/admin/roles', { waitUntil: 'domcontentloaded' });
  await waitForSettle(page, 45_000);
  await page.getByText('Loading roles...').waitFor({ state: 'hidden', timeout: 90_000 }).catch(() => {});
  await expect(page.getByRole('heading', { name: /Roles & Permissions/i })).toBeVisible({ timeout: 90_000 });
}

test.afterAll(async () => {
  await cleanupE2ETenant(ctx);
  const { PrismaClient } = await import('@prisma/client');
  const prisma = new PrismaClient();
  try {
    if (extraUserId) await prisma.user.delete({ where: { id: extraUserId } }).catch(() => {});
    for (const id of permissionIds) {
      await prisma.permission.delete({ where: { id } }).catch(() => {});
    }
  } finally {
    await prisma.$disconnect();
  }
});

test.beforeEach(async ({}, testInfo) => {
  skipIfOffline(serverUp, testInfo);
});

test('ADM-ROLE-01: Roles page supports clone, preview, and modal confirmation', async ({ page }) => {
  test.setTimeout(120_000);
  await login(page);

  await openRolesPage(page);
  await page.getByText('E2E Roles Operator').click();
  await expect(page.getByRole('button', { name: 'Clone Role' })).toBeVisible();

  const cloneResponse = page.waitForResponse(
    response => response.url().includes(`/api/admin/roles/${roleId}/clone`) && response.request().method() === 'POST',
    { timeout: 60_000 },
  );
  await page.getByRole('button', { name: 'Clone Role' }).click();
  expect((await cloneResponse).status()).toBe(201);
  await page.getByText('Loading roles...').waitFor({ state: 'hidden', timeout: 60_000 }).catch(() => {});

  await page.getByText(roleCode, { exact: true }).first().click();
  await page.getByRole('button', { name: /fleet:edit:roles_e2e/i }).click();
  await expect(page.getByText('Permission Change Preview')).toBeVisible({ timeout: 20_000 });
  await expect(page.getByText(/1 assigned user/i)).toBeVisible({ timeout: 20_000 });
  await expect(page.getByText('Affected user sample')).toBeVisible({ timeout: 20_000 });
  await expect(page.getByText(/e2e-roles-user-/i)).toBeVisible({ timeout: 20_000 });

  const roleRow = page.getByText(roleCode).locator('xpath=ancestor::div[contains(@class,"cursor-pointer")][1]');
  await roleRow.getByRole('button', { name: 'Delete' }).click();
  await expect(page.getByRole('heading', { name: 'Delete Role' })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Cancel', exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'Cancel', exact: true }).click();
});

test('ADM-ROLE-02: Roles page creates, compares, saves, and approval-gates rollback', async ({ page }) => {
  test.setTimeout(150_000);
  await login(page);

  await openRolesPage(page);

  createRoleCode = `E2E_ROLES_CREATED_${Date.now()}`;
  const createResponse = page.waitForResponse(
    response => response.url().includes('/api/admin/roles') && response.request().method() === 'POST',
    { timeout: 60_000 },
  );
  await page.getByRole('button', { name: '+ New Role' }).click();
  await page.getByPlaceholder('e.g. Senior Leasing Officer').fill('E2E Created Role');
  await page.getByPlaceholder('e.g. SENIOR_LEASING_OFFICER').fill(createRoleCode);
  await page.getByPlaceholder('Brief description of responsibilities').fill('Created by granular roles E2E');
  await page.getByRole('button', { name: 'Create Role' }).click();
  expect((await createResponse).status()).toBe(201);
  await expect(page.getByText('Role created.')).toBeVisible({ timeout: 20_000 });
  await expect(page.getByText(createRoleCode, { exact: true })).toBeVisible({ timeout: 30_000 });

  await page.getByText(roleCode, { exact: true }).first().click();
  await page.locator(`select:has(option[value="${compareRoleId}"])`).selectOption(compareRoleId);
  const compareResponse = page.waitForResponse(
    response => response.url().includes('/api/admin/roles/compare') && response.request().method() === 'GET',
    { timeout: 60_000 },
  );
  await page.getByRole('button', { name: 'Compare' }).click();
  expect((await compareResponse).status()).toBe(200);
  await expect(page.getByText(/permissions added/i)).toBeVisible({ timeout: 20_000 });
  await expect(page.getByText(/permissions missing/i)).toBeVisible({ timeout: 20_000 });

  await page.getByRole('button', { name: /fleet:edit:roles_e2e/i }).click();
  await expect(page.getByText('Permission Change Preview')).toBeVisible({ timeout: 20_000 });
  await expect(page.getByText(/1 assigned user/i)).toBeVisible({ timeout: 20_000 });

  const saveResponse = page.waitForResponse(
    response => response.url().includes(`/api/admin/roles/${roleId}/permissions`) && response.request().method() === 'PUT',
    { timeout: 60_000 },
  );
  await page.getByRole('button', { name: 'Save Permissions' }).click();
  expect((await saveResponse).status()).toBe(200);
  await expect(page.getByRole('button', { name: 'Save Permissions' })).toBeVisible({ timeout: 30_000 });
  await expect(page.getByText('Permissions saved for E2E Roles Operator.')).toBeVisible({ timeout: 20_000 });
  await expect(page.getByText(/Role History/i)).toBeVisible();
  await expect(page.getByText('BASELINE', { exact: true }).or(page.getByText('PERMISSIONS', { exact: true })).first()).toBeVisible({ timeout: 20_000 });

  const rollbackButton = page.getByRole('button', { name: 'Rollback' }).first();
  await expect(rollbackButton).toBeVisible({ timeout: 20_000 });
  await rollbackButton.click();
  await expect(page.getByRole('heading', { name: 'Rollback Role' })).toBeVisible();
  const rollbackResponse = page.waitForResponse(
    response => response.url().includes(`/api/admin/roles/${roleId}/versions`) && response.request().method() === 'POST',
    { timeout: 60_000 },
  );
  await page.getByRole('button', { name: 'Rollback', exact: true }).last().click();
  expect((await rollbackResponse).status()).toBe(428);
  await expect(page.getByText(/Rollback queued for approval/i)).toBeVisible({ timeout: 20_000 });
});
