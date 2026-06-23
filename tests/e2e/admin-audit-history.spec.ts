import { expect, test } from '@playwright/test';
import { hashPassword } from '../test-utils';
import { isServerAvailable, login, skipIfOffline, waitForSettle } from './helpers';

let serverUp = false;
let tenantId = '';
let userId = '';
let roleId = '';
let email = '';
let password = '';
let tenantName = '';
let auditEntityId = '';
let changeEntityId = '';
let unique = '';

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
  auditEntityId = crypto.randomUUID();
  changeEntityId = crypto.randomUUID();
  unique = `E2E-AUDIT-${uid}`;
  tenantName = `E2E Audit ${uid}`;
  email = `e2e-audit-${uid.toLowerCase()}@test.example.com`;
  password = `E2EAudit${uid}!`;

  try {
    await prisma.$executeRawUnsafe(`
      CREATE TABLE IF NOT EXISTS audit_logs (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        tenant_id TEXT,
        tenant_name TEXT,
        branch_id TEXT,
        branch_name TEXT,
        entity_type TEXT NOT NULL,
        entity_id TEXT,
        entity_name TEXT,
        user_id TEXT,
        user_name TEXT,
        user_email TEXT,
        user_role TEXT,
        action TEXT NOT NULL,
        details TEXT,
        ip_address TEXT,
        user_agent TEXT,
        session_id TEXT,
        login_time TIMESTAMPTZ,
        logout_time TIMESTAMPTZ,
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      )
    `);
    await prisma.$executeRawUnsafe(`
      CREATE TABLE IF NOT EXISTS admin_change_history (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        tenant_id TEXT,
        entity_type TEXT NOT NULL,
        entity_id TEXT,
        action TEXT NOT NULL,
        actor_user_id TEXT,
        actor_role TEXT,
        impersonated_by TEXT,
        before_json JSONB,
        after_json JSONB,
        summary TEXT,
        ip_address TEXT,
        user_agent TEXT,
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      )
    `);
    await prisma.tenant.create({
      data: {
        id: tenantId,
        name: tenantName,
        code: `E2E-AUD-${uid}`,
        domain: `audit-${uid.toLowerCase()}.example.com`,
        plan: 'ENTERPRISE',
        isActive: true,
      },
    });
    await prisma.user.create({
      data: {
        id: userId,
        email,
        username: `e2e-audit-${uid.toLowerCase()}`,
        firstName: 'Audit',
        lastName: 'E2E',
        isActive: true,
        updatedAt: new Date(),
      },
    });
    await prisma.$executeRawUnsafe(`UPDATE "User" SET password_hash = $1 WHERE id = $2`, hashPassword(password), userId);
    await prisma.role.create({
      data: { id: roleId, tenantId, name: 'Tenant Administrator', code: 'TENANT_ADMIN', isSystem: true },
    });
    await prisma.userTenant.create({
      data: { id: crypto.randomUUID(), userId, tenantId, roleId, isActive: true },
    });
    await prisma.$executeRawUnsafe(
      `INSERT INTO audit_logs
         (tenant_id, tenant_name, entity_type, entity_id, entity_name,
          user_id, user_name, user_email, user_role, action, details, ip_address)
       VALUES ($1,$2,'User',$3,$4,$5,'Audit E2E',$6,'TENANT_ADMIN','UPDATE',$7,'198.51.100.8')`,
      tenantId,
      tenantName,
      auditEntityId,
      `${unique} user profile`,
      userId,
      email,
      `${unique} updated user profile`,
    );
    await prisma.$executeRawUnsafe(
      `INSERT INTO admin_change_history
         (tenant_id, entity_type, entity_id, action, actor_user_id, actor_role,
          impersonated_by, before_json, after_json, summary, ip_address)
       VALUES ($1,'PlatformSettings',$2,'UPDATE',$3,'TENANT_ADMIN','platform-operator',
               $4::jsonb,$5::jsonb,$6,'198.51.100.9')`,
      tenantId,
      changeEntityId,
      userId,
      JSON.stringify({ smtp_password: 'old-secret', timezone: 'UTC' }),
      JSON.stringify({ smtp_password: 'new-secret', timezone: 'Asia/Dubai' }),
      `${unique} changed platform SMTP settings`,
    );
  } finally {
    await prisma.$disconnect();
  }
});

test.afterAll(async () => {
  const { PrismaClient } = await import('@prisma/client');
  const prisma = new PrismaClient();
  try {
    if (auditEntityId) await prisma.$executeRawUnsafe(`DELETE FROM audit_logs WHERE entity_id = $1`, auditEntityId).catch(() => {});
    if (changeEntityId) await prisma.$executeRawUnsafe(`DELETE FROM admin_change_history WHERE entity_id = $1`, changeEntityId).catch(() => {});
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

test('Audit Log exposes audit rows and before/after change history details', async ({ page }) => {
  test.setTimeout(180_000);
  await login(page, email, password);

  await page.goto('/admin/audit-logs', { waitUntil: 'domcontentloaded' });
  await waitForSettle(page, 60_000);
  await expect(page.getByRole('heading', { name: 'User Audit Log' })).toBeVisible({ timeout: 60_000 });

  await page.getByPlaceholder(/User name, email, entity/i).fill(unique);
  const auditRow = page.locator('tr', { hasText: `${unique} user profile` }).first();
  await expect(auditRow).toBeVisible({ timeout: 60_000 });
  await auditRow.getByRole('button', { name: /View/ }).click();
  await expect(page.getByRole('heading', { name: 'Audit Log Detail' })).toBeVisible();
  const auditDrawer = page.locator('div.fixed', { has: page.getByRole('heading', { name: 'Audit Log Detail' }) });
  await expect(auditDrawer.getByText(`${unique} updated user profile`)).toBeVisible();
  await page.getByRole('button', { name: 'Close' }).click();

  await page.getByRole('button', { name: 'Change History' }).click();
  await page.getByPlaceholder(/User name, email, entity/i).fill(unique);
  const changeRow = page.locator('tr', { hasText: `${unique} changed platform SMTP settings` }).first();
  await expect(changeRow).toBeVisible({ timeout: 60_000 });
  await expect(changeRow.getByText('platform-operator')).toBeVisible();
  await changeRow.getByRole('button', { name: /View/ }).click();

  await expect(page.getByRole('heading', { name: 'Change History Detail' })).toBeVisible();
  const changeDrawer = page.locator('div.fixed', { has: page.getByRole('heading', { name: 'Change History Detail' }) });
  await expect(changeDrawer.getByText('Impersonated by platform-operator')).toBeVisible();
  await expect(changeDrawer.getByText('Asia/Dubai')).toBeVisible();
  await expect(changeDrawer.getByText('********').first()).toBeVisible();
  await expect(changeDrawer.getByText('new-secret')).toHaveCount(0);
});
