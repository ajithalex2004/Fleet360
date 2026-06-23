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
let workflowId = '';
let stepId = '';
let workflowName = '';

test.describe.configure({ mode: 'serial' });

test.beforeAll(async () => {
  serverUp = await isServerAvailable();
  if (!serverUp) return;
  ctx = await createE2ETenant('Admin Workflows');

  const { PrismaClient } = await import('@prisma/client');
  const crypto = await import('crypto');
  const prisma = new PrismaClient();
  const uid = crypto.randomUUID().slice(0, 8).toUpperCase();
  workflowId = crypto.randomUUID();
  stepId = crypto.randomUUID();
  workflowName = `E2E Workflow ${uid}`;

  try {
    await prisma.$executeRawUnsafe(`
      CREATE TABLE IF NOT EXISTS "WorkflowDefinition" (
        id TEXT PRIMARY KEY,
        name TEXT NOT NULL,
        module TEXT NOT NULL,
        procedure TEXT NOT NULL,
        description TEXT,
        "isActive" BOOLEAN DEFAULT true,
        "serviceTypeId" TEXT,
        "tenantId" TEXT,
        "scopeId" UUID,
        "defaultAssigneeType" TEXT DEFAULT 'SPECIFIC_USER',
        "defaultAssigneeEmail" TEXT,
        "defaultAssigneeRoleCode" TEXT,
        "defaultEmailSubject" TEXT,
        "defaultEmailBody" TEXT,
        "defaultSlaHours" INTEGER DEFAULT 24,
        "defaultEscalationEmail" TEXT,
        "defaultEscalationHours" INTEGER DEFAULT 48,
        "createdAt" TIMESTAMP DEFAULT NOW(),
        "updatedAt" TIMESTAMP DEFAULT NOW()
      )
    `);
    await prisma.$executeRawUnsafe(`ALTER TABLE "WorkflowDefinition" ADD COLUMN IF NOT EXISTS "serviceTypeId" TEXT`);
    await prisma.$executeRawUnsafe(`ALTER TABLE "WorkflowDefinition" ADD COLUMN IF NOT EXISTS "tenantId" TEXT`);
    await prisma.$executeRawUnsafe(`ALTER TABLE "WorkflowDefinition" ADD COLUMN IF NOT EXISTS "scopeId" UUID`);
    await prisma.$executeRawUnsafe(`ALTER TABLE "WorkflowDefinition" ADD COLUMN IF NOT EXISTS "defaultAssigneeType" TEXT DEFAULT 'SPECIFIC_USER'`);
    await prisma.$executeRawUnsafe(`ALTER TABLE "WorkflowDefinition" ADD COLUMN IF NOT EXISTS "defaultAssigneeEmail" TEXT`);
    await prisma.$executeRawUnsafe(`ALTER TABLE "WorkflowDefinition" ADD COLUMN IF NOT EXISTS "defaultAssigneeRoleCode" TEXT`);
    await prisma.$executeRawUnsafe(`ALTER TABLE "WorkflowDefinition" ADD COLUMN IF NOT EXISTS "defaultEmailSubject" TEXT`);
    await prisma.$executeRawUnsafe(`ALTER TABLE "WorkflowDefinition" ADD COLUMN IF NOT EXISTS "defaultEmailBody" TEXT`);
    await prisma.$executeRawUnsafe(`ALTER TABLE "WorkflowDefinition" ADD COLUMN IF NOT EXISTS "defaultSlaHours" INTEGER DEFAULT 24`);
    await prisma.$executeRawUnsafe(`ALTER TABLE "WorkflowDefinition" ADD COLUMN IF NOT EXISTS "defaultEscalationEmail" TEXT`);
    await prisma.$executeRawUnsafe(`ALTER TABLE "WorkflowDefinition" ADD COLUMN IF NOT EXISTS "defaultEscalationHours" INTEGER DEFAULT 48`);
    await prisma.$executeRawUnsafe(`
      CREATE TABLE IF NOT EXISTS "WorkflowStep" (
        id TEXT PRIMARY KEY,
        "workflowId" TEXT NOT NULL,
        "stepOrder" INTEGER NOT NULL,
        "stepName" TEXT NOT NULL,
        "stepType" TEXT NOT NULL DEFAULT 'APPROVAL',
        "assigneeType" TEXT NOT NULL DEFAULT 'SPECIFIC_USER',
        "assigneeEmail" TEXT,
        "assigneeRoleCode" TEXT,
        "multiApproverEmails" TEXT,
        "requireAllApprovers" BOOLEAN DEFAULT false,
        "emailSubject" TEXT,
        "emailBody" TEXT,
        "slaHours" INTEGER DEFAULT 24,
        "escalationEmail" TEXT,
        "escalationHours" INTEGER DEFAULT 48,
        "conditionJson" TEXT,
        "isOptional" BOOLEAN DEFAULT false,
        "createdAt" TIMESTAMP DEFAULT NOW()
      )
    `);
    await prisma.$executeRawUnsafe(`
      CREATE TABLE IF NOT EXISTS "WorkflowInstance" (
        id TEXT PRIMARY KEY,
        "workflowId" TEXT NOT NULL,
        status TEXT DEFAULT 'IN_PROGRESS'
      )
    `);
    await prisma.$executeRawUnsafe(`
      CREATE TABLE IF NOT EXISTS "WorkflowStepInstance" (
        id TEXT PRIMARY KEY,
        "workflowInstanceId" TEXT NOT NULL,
        "stepId" TEXT NOT NULL,
        "stepOrder" INTEGER NOT NULL,
        "stepName" TEXT NOT NULL,
        status TEXT DEFAULT 'PENDING'
      )
    `);
    await prisma.$executeRawUnsafe(
      `INSERT INTO "WorkflowDefinition"
         (id, name, module, procedure, description, "isActive", "tenantId")
       VALUES ($1,$2,'LEASING','QUOTATION_APPROVAL',$3,true,$4)`,
      workflowId,
      workflowName,
      'Seeded workflow for granular admin E2E',
      ctx.tenantId,
    );
    await prisma.$executeRawUnsafe(
      `INSERT INTO "WorkflowStep"
         (id, "workflowId", "stepOrder", "stepName", "stepType", "assigneeType", "assigneeEmail", "slaHours")
       VALUES ($1,$2,1,'Initial Manager Approval','APPROVAL','SPECIFIC_USER','manager@example.com',24)`,
      stepId,
      workflowId,
    );
  } finally {
    await prisma.$disconnect();
  }
});

test.afterAll(async () => {
  const { PrismaClient } = await import('@prisma/client');
  const prisma = new PrismaClient();
  try {
    if (workflowId) {
      await prisma.$executeRawUnsafe(`DELETE FROM admin_change_history WHERE entity_id IN ($1,$2) OR (after_json->>'workflowId') = $1`, workflowId, stepId).catch(() => {});
      await prisma.$executeRawUnsafe(`DELETE FROM audit_logs WHERE entity_id IN ($1,$2)`, workflowId, stepId).catch(() => {});
      await prisma.$executeRawUnsafe(`DELETE FROM admin_approval_requests WHERE target_id IN ($1,$2)`, workflowId, stepId).catch(() => {});
      await prisma.$executeRawUnsafe(`DELETE FROM "WorkflowStep" WHERE "workflowId" = $1 OR id = $2`, workflowId, stepId).catch(() => {});
      await prisma.$executeRawUnsafe(`DELETE FROM "WorkflowDefinition" WHERE id = $1 OR name LIKE $2`, workflowId, `${workflowName}%`).catch(() => {});
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

async function openWorkflowsPage(page: Page) {
  await page.goto('/admin/workflows', { waitUntil: 'domcontentloaded' });
  await waitForSettle(page, 60_000);
  await page.getByText('Loading...').waitFor({ state: 'hidden', timeout: 60_000 }).catch(() => {});
  await expect(page.getByRole('heading', { name: 'Business Rule & Workflow Management' })).toBeVisible({ timeout: 60_000 });
}

function workflowCard(page: Page) {
  return page.locator('div.rounded-2xl').filter({ hasText: workflowName }).first();
}

test('ADM-WF-01: Workflow page shows definitions and queues dangerous UI mutations', async ({ page }) => {
  test.setTimeout(240_000);
  await login(page);
  await openWorkflowsPage(page);

  const card = workflowCard(page);
  await expect(card).toBeVisible({ timeout: 60_000 });
  const loadWorkflow = page.waitForResponse(
    response => response.url().includes(`/api/admin/workflows/${workflowId}`) && response.request().method() === 'GET',
    { timeout: 90_000 },
  );
  await page.getByText(workflowName, { exact: true }).click();
  expect((await loadWorkflow).status()).toBe(200);
  await expect(page.getByText('Initial Manager Approval')).toBeVisible({ timeout: 60_000 });

  await page.getByRole('button', { name: '+ Add Step' }).click();
  await page.getByPlaceholder('e.g. Operations Manager Approval').fill('Finance Approval');
  await page.getByRole('button', { name: 'Assignee' }).click();
  await page.getByPlaceholder('manager@company.com').fill('finance@example.com');
  const addStepResponse = page.waitForResponse(
    response => response.url().includes(`/api/admin/workflows/${workflowId}/steps`) && response.request().method() === 'POST',
    { timeout: 90_000 },
  );
  await page.getByRole('button', { name: 'Add Step', exact: true }).click();
  expect((await addStepResponse).status()).toBe(428);
  await expect(page.getByText(/Step creation queued for approval/i)).toBeVisible({ timeout: 30_000 });

  await card.hover();
  const cloneResponse = page.waitForResponse(
    response => response.url().includes(`/api/admin/workflows/${workflowId}/duplicate`) && response.request().method() === 'POST',
    { timeout: 90_000 },
  );
  await card.getByRole('button', { name: 'Copy' }).click();
  expect((await cloneResponse).status()).toBe(428);
  await expect(page.getByText(/Workflow clone queued for approval/i)).toBeVisible({ timeout: 30_000 });

  await card.hover();
  await card.getByRole('button', { name: 'Del' }).click();
  await expect(page.getByRole('heading', { name: 'Delete Workflow' })).toBeVisible();
  const deleteResponse = page.waitForResponse(
    response => response.url().includes(`/api/admin/workflows/${workflowId}`) && response.request().method() === 'DELETE',
    { timeout: 90_000 },
  );
  await page.getByRole('button', { name: 'Delete workflow' }).click();
  expect((await deleteResponse).status()).toBe(428);
  await expect(page.getByText(/Workflow deletion queued for approval/i)).toBeVisible({ timeout: 30_000 });
  await expect(page.getByRole('heading', { name: 'Delete Workflow' })).toHaveCount(0);
});

test('ADM-WF-02: Approved workflow update executes and writes change history', async ({ page }) => {
  test.setTimeout(180_000);
  await login(page);

  const queued = await page.request.put(`/api/admin/workflows/${workflowId}`, {
    data: { description: 'Queued workflow description change' },
    timeout: 60_000,
  });
  expect(queued.status()).toBe(428);

  const { PrismaClient } = await import('@prisma/client');
  const prisma = new PrismaClient();
  let approvalId = '';
  try {
    const approvals = await prisma.$queryRawUnsafe<Array<{ id: string }>>(
      `SELECT id::text
         FROM admin_approval_requests
        WHERE requested_by = $1
          AND action = 'workflow.update'
          AND target_id = $2
        ORDER BY created_at DESC
        LIMIT 1`,
      ctx!.userId,
      workflowId,
    );
    approvalId = approvals[0]?.id ?? '';
    expect(approvalId).toBeTruthy();
    await prisma.$executeRawUnsafe(
      `UPDATE admin_approval_requests SET status = 'APPROVED', decided_at = NOW(), updated_at = NOW() WHERE id = $1::uuid`,
      approvalId,
    );
  } finally {
    await prisma.$disconnect();
  }

  const executed = await page.request.put(`/api/admin/workflows/${workflowId}`, {
    data: { description: 'Approved workflow description change' },
    headers: { 'x-admin-approval-id': approvalId },
    timeout: 60_000,
  });
  expect(executed.status()).toBe(200);

  const prisma2 = new PrismaClient();
  try {
    const [workflow] = await prisma2.$queryRawUnsafe<Array<{ description: string }>>(
      `SELECT description FROM "WorkflowDefinition" WHERE id = $1`,
      workflowId,
    );
    expect(workflow.description).toBe('Approved workflow description change');

    const changes = await prisma2.$queryRawUnsafe<Array<{ action: string; summary: string | null }>>(
      `SELECT action, summary
         FROM admin_change_history
        WHERE entity_type = 'WorkflowDefinition'
          AND entity_id = $1
        ORDER BY created_at DESC`,
      workflowId,
    );
    expect(changes.some(change => change.action === 'UPDATE' && change.summary?.includes('Updated workflow'))).toBe(true);
  } finally {
    await prisma2.$disconnect();
  }
});
