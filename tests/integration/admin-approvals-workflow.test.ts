import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { NextRequest } from 'next/server';
import { prisma } from '@/lib/prisma';
import { markAdminApprovalExecuted } from '@/lib/admin-approvals';
import {
  cleanupTenant,
  cleanupUser,
  createAuthHeaders,
  createSessionToken,
  createTestUser,
  createTestUserTenant,
  isServerRunning,
  makeRequest,
  seedTestTenantFull,
  type SeedResult,
  type TestUser,
} from '../setup';

let serverAvailable = false;

type AdminActor = {
  user: TestUser;
  headers: Record<string, string>;
};

type ApprovalListRow = {
  id: string;
  tenant_id: string;
  approvals: number;
  required_approvals: number;
  status: string;
  actor_decision: string | null;
  is_requester: boolean;
  governance: {
    impact: string[];
    payloadKeys: string[];
    sla: { dueHours: number; escalationHours: number; status: string };
    quorum: { mode: string; requiredApprovals: number; requesterCanVote: boolean };
    beforeAfter: { before: Record<string, unknown>; after: Record<string, unknown>; summary: string[] };
  };
};

type ApprovalTemplateRow = {
  id: string;
  requiredApprovals: number;
  dueHours: number;
  escalationHours: number;
};

function routeHeaders(seed: SeedResult, role = seed.role.code, extra: Record<string, string> = {}) {
  return {
    ...seed.headers,
    'x-user-id': seed.user.id,
    'x-tenant-id': seed.tenant.id,
    'x-user-role': role,
    ...extra,
  };
}

async function createTenantAdminActor(seed: SeedResult): Promise<AdminActor> {
  const user = await createTestUser();
  await createTestUserTenant(user.id, seed.tenant.id, seed.role.id);
  const token = await createSessionToken(user.id, seed.tenant.id, seed.tenant.plan, 'TENANT_ADMIN');
  return {
    user,
    headers: {
      ...createAuthHeaders(token),
      'x-user-id': user.id,
      'x-tenant-id': seed.tenant.id,
      'x-user-role': 'TENANT_ADMIN',
    },
  };
}

async function createApproval(seed: SeedResult, overrides: Record<string, unknown> = {}) {
  const res = await makeRequest(
    'POST',
    '/api/admin/approvals',
    {
      action: `test.admin-danger.${Date.now()}`,
      tenantId: seed.tenant.id,
      targetType: 'IntegrationTest',
      targetId: `target-${Date.now()}`,
      summary: 'Integration test dangerous admin action',
      payload: { before: { enabled: false }, after: { enabled: true } },
      requiredApprovals: 2,
      ...overrides,
    },
    routeHeaders(seed, 'TENANT_ADMIN', { 'x-impersonated-by': 'integration-suite' }),
  );
  const text = await res.text();
  const body = text ? JSON.parse(text) : {};
  expect(res.status).toBe(201);
  expect(body.id).toBeTruthy();
  return body as { id: string; status: string; requiredApprovals: number; governance?: Record<string, unknown> };
}

describe('Admin Approvals multi-actor workflow', () => {
  let requesterSeed: SeedResult;
  let otherTenantSeed: SeedResult;
  let approverOne: AdminActor;
  let approverTwo: AdminActor;
  const createdUserIds: string[] = [];
  const createdApprovalIds: string[] = [];

  beforeAll(async () => {
    serverAvailable = await isServerRunning();
    if (!serverAvailable) return;

    [requesterSeed, otherTenantSeed] = await Promise.all([
      seedTestTenantFull('ENTERPRISE', 'TENANT_ADMIN'),
      seedTestTenantFull('ENTERPRISE', 'TENANT_ADMIN'),
    ]);
    [approverOne, approverTwo] = await Promise.all([
      createTenantAdminActor(requesterSeed),
      createTenantAdminActor(requesterSeed),
    ]);
    createdUserIds.push(requesterSeed.user.id, otherTenantSeed.user.id, approverOne.user.id, approverTwo.user.id);
  }, 180_000);

  afterAll(async () => {
    if (createdUserIds.length) {
      for (const userId of createdUserIds) {
        await prisma.$executeRawUnsafe(`DELETE FROM admin_change_history WHERE actor_user_id = $1`, userId).catch(() => {});
        await prisma.$executeRawUnsafe(`DELETE FROM audit_logs WHERE user_id = $1`, userId).catch(() => {});
        await prisma.$executeRawUnsafe(`DELETE FROM admin_approval_requests WHERE requested_by = $1`, userId).catch(() => {});
      }
    }
    await Promise.all([
      approverOne ? cleanupUser(approverOne.user.id) : Promise.resolve(),
      approverTwo ? cleanupUser(approverTwo.user.id) : Promise.resolve(),
    ]);
    await Promise.all([
      requesterSeed ? cleanupTenant(requesterSeed.tenant.id).then(() => cleanupUser(requesterSeed.user.id)) : Promise.resolve(),
      otherTenantSeed ? cleanupTenant(otherTenantSeed.tenant.id).then(() => cleanupUser(otherTenantSeed.user.id)) : Promise.resolve(),
    ]);
    for (const approvalId of createdApprovalIds) {
      await prisma.notificationLog.deleteMany({
        where: {
          type: 'AdminApproval',
          body: { contains: approvalId },
        },
      }).catch(() => {});
    }
  }, 90_000);

  it('requires two distinct non-requester approvals and records a traceable lifecycle', async () => {
    if (!serverAvailable) return;

    const approval = await createApproval(requesterSeed, { requiredApprovals: 1 });
    createdApprovalIds.push(approval.id);
    expect(approval.requiredApprovals).toBe(2);
    expect(approval.governance).toMatchObject({
      template: 'high-risk-admin-change',
      requiredApprovals: 2,
      quorum: { mode: 'distinct_non_requester', requesterCanVote: false },
    });

    const selfVote = await makeRequest(
      'POST',
      `/api/admin/approvals/${approval.id}/vote`,
      { decision: 'APPROVE', note: 'self approval should be blocked' },
      routeHeaders(requesterSeed),
    );
    expect(selfVote.status).toBe(403);

    const firstVote = await makeRequest(
      'POST',
      `/api/admin/approvals/${approval.id}/vote`,
      { decision: 'APPROVE', note: 'reviewed by approver one' },
      approverOne.headers,
    );
    expect(firstVote.status).toBe(200);
    expect(await firstVote.json()).toMatchObject({
      status: 'PENDING',
      approvals: 1,
      remainingApprovals: 1,
      actorDecision: 'APPROVE',
    });

    const pendingList = await makeRequest(
      'GET',
      `/api/admin/approvals?status=PENDING&tenantId=${requesterSeed.tenant.id}`,
      undefined,
      routeHeaders(requesterSeed),
    );
    expect(pendingList.status).toBe(200);
    const pendingBody = await pendingList.json();
    const pendingRow = (pendingBody.approvals as ApprovalListRow[]).find((row) => row.id === approval.id);
    expect(pendingRow).toMatchObject({
      id: approval.id,
      tenant_id: requesterSeed.tenant.id,
      approvals: 1,
      required_approvals: 2,
      status: 'PENDING',
      actor_decision: null,
      is_requester: true,
    });
    expect(pendingRow).toBeDefined();

    const approverView = await makeRequest(
      'GET',
      `/api/admin/approvals?status=PENDING&tenantId=${requesterSeed.tenant.id}`,
      undefined,
      approverOne.headers,
    );
    expect(approverView.status).toBe(200);
    const approverViewBody = await approverView.json();
    const approverRow = (approverViewBody.approvals as ApprovalListRow[]).find((row) => row.id === approval.id);
    expect(approverRow).toMatchObject({
      actor_decision: 'APPROVE',
      is_requester: false,
    });
    expect(pendingRow!.governance.impact).toContain('Tenant scoped');
    expect(pendingRow!.governance.impact).toContain('Dangerous change');
    expect(pendingRow!.governance.impact).toContain('Before/after captured');
    expect(pendingRow!.governance.payloadKeys).toEqual(expect.arrayContaining(['before', 'after']));
    expect(pendingRow!.governance.sla).toMatchObject({
      dueHours: 8,
      escalationHours: 4,
      status: 'on_track',
    });
    expect(pendingRow!.governance.quorum).toMatchObject({
      mode: 'distinct_non_requester',
      requiredApprovals: 2,
      requesterCanVote: false,
    });
    expect(pendingRow!.governance.beforeAfter.before).toMatchObject({ enabled: false });
    expect(pendingRow!.governance.beforeAfter.after).toMatchObject({ enabled: true });
    expect(pendingRow!.governance.beforeAfter.summary).toEqual(expect.arrayContaining(['enabled: false -> true']));

    const secondVote = await makeRequest(
      'POST',
      `/api/admin/approvals/${approval.id}/vote`,
      { decision: 'APPROVE', note: 'reviewed by approver two' },
      approverTwo.headers,
    );
    expect(secondVote.status).toBe(200);
    expect(await secondVote.json()).toMatchObject({ status: 'APPROVED' });

    await markAdminApprovalExecuted(
      new NextRequest('http://localhost/api/integration-test', { headers: routeHeaders(requesterSeed) }),
      {
        userId: requesterSeed.user.id,
        tenantId: requesterSeed.tenant.id,
        role: 'TENANT_ADMIN',
        isSuperAdmin: false,
        isTenantAdmin: true,
      },
      approval.id,
      { status: 'EXECUTED', route: '/api/integration-test' },
    );

    const rows = await prisma.$queryRawUnsafe<Array<{
      status: string;
      execution_status: string | null;
      approvals: bigint;
      rejections: bigint;
    }>>(
      `SELECT r.status, r.execution_status,
              COUNT(v.id) FILTER (WHERE v.decision = 'APPROVE') AS approvals,
              COUNT(v.id) FILTER (WHERE v.decision = 'REJECT') AS rejections
         FROM admin_approval_requests r
         LEFT JOIN admin_approval_votes v ON v.approval_request_id = r.id
        WHERE r.id = $1::uuid
        GROUP BY r.id`,
      approval.id,
    );
    expect(rows[0]).toMatchObject({ status: 'APPROVED', execution_status: 'EXECUTED' });
    expect(Number(rows[0].approvals)).toBe(2);
    expect(Number(rows[0].rejections)).toBe(0);

    const history = await prisma.$queryRawUnsafe<Array<{ action: string; after_json: Record<string, unknown>; impersonated_by: string | null }>>(
      `SELECT action, after_json, impersonated_by
         FROM admin_change_history
        WHERE entity_type = 'AdminApprovalRequest'
          AND entity_id = $1
        ORDER BY created_at ASC`,
      approval.id,
    );
    expect(history.map(row => row.action)).toEqual(expect.arrayContaining(['CREATE', 'APPROVE', 'EXECUTE']));
    expect(history.find(row => row.action === 'CREATE')?.impersonated_by).toBe('integration-suite');
    expect(history.find(row => row.action === 'CREATE')?.after_json.policy).toMatchObject({
      quorum: { mode: 'distinct_non_requester', requiredApprovals: 2 },
      sla: { dueHours: 8, escalationHours: 4 },
    });
    expect(history.at(-1)?.after_json).toMatchObject({ status: 'APPROVED', approvals: 2, requiredApprovals: 2 });

    const notifications = await prisma.notificationLog.findMany({
      where: {
        type: 'AdminApproval',
        body: { contains: approval.id },
      },
    });
    expect(notifications.map(row => row.triggerReason)).toEqual(expect.arrayContaining([
      'admin_approval.requested',
      'admin_approval.approved',
      'admin_approval.executed',
    ]));
  }, 120_000);

  it('keeps tenant admins inside their tenant and closes the request on rejection', async () => {
    if (!serverAvailable) return;

    const approval = await createApproval(requesterSeed);
    createdApprovalIds.push(approval.id);

    const crossTenantVote = await makeRequest(
      'POST',
      `/api/admin/approvals/${approval.id}/vote`,
      { decision: 'APPROVE' },
      routeHeaders(otherTenantSeed),
    );
    expect(crossTenantVote.status).toBe(403);

    const reject = await makeRequest(
      'POST',
      `/api/admin/approvals/${approval.id}/vote`,
      { decision: 'REJECT', note: 'missing evidence' },
      approverOne.headers,
    );
    expect(reject.status).toBe(200);
    expect(await reject.json()).toMatchObject({ status: 'REJECTED' });

    const lateApprove = await makeRequest(
      'POST',
      `/api/admin/approvals/${approval.id}/vote`,
      { decision: 'APPROVE', note: 'too late' },
      approverTwo.headers,
    );
    expect(lateApprove.status).toBe(409);

    const rows = await prisma.$queryRawUnsafe<Array<{ status: string; rejections: bigint }>>(
      `SELECT r.status,
              COUNT(v.id) FILTER (WHERE v.decision = 'REJECT') AS rejections
         FROM admin_approval_requests r
         LEFT JOIN admin_approval_votes v ON v.approval_request_id = r.id
        WHERE r.id = $1::uuid
        GROUP BY r.id`,
      approval.id,
    );
    expect(rows[0].status).toBe('REJECTED');
    expect(Number(rows[0].rejections)).toBe(1);
  }, 120_000);

  it('allows super admins to tune policy templates used by new approvals', async () => {
    if (!serverAvailable) return;

    const list = await makeRequest(
      'GET',
      '/api/admin/approvals/templates',
      undefined,
      routeHeaders(requesterSeed, 'SUPER_ADMIN'),
    );
    expect(list.status).toBe(200);
    const listBody = await list.json();
    const original = (listBody.templates as ApprovalTemplateRow[]).find((template) => template.id === 'standard-admin-change');
    expect(original).toBeTruthy();

    const updatedPayload = {
      ...original,
      requiredApprovals: 3,
      dueHours: 36,
      escalationHours: 18,
      notificationChannels: ['in_app', 'email'],
    };
    const update = await makeRequest(
      'PUT',
      '/api/admin/approvals/templates',
      updatedPayload,
      routeHeaders(requesterSeed, 'SUPER_ADMIN'),
    );
    expect(update.status).toBe(200);
    expect(await update.json()).toMatchObject({
      template: {
        id: 'standard-admin-change',
        requiredApprovals: 3,
        dueHours: 36,
        escalationHours: 18,
      },
    });

    try {
      const approval = await createApproval(requesterSeed, {
        action: `test.standard-template.${Date.now()}`,
        requiredApprovals: undefined,
      });
      createdApprovalIds.push(approval.id);
      expect(approval.requiredApprovals).toBe(3);
      expect(approval.governance).toMatchObject({
        template: 'standard-admin-change',
        requiredApprovals: 3,
        sla: { dueHours: 36, escalationHours: 18 },
      });
    } finally {
      await makeRequest(
        'PUT',
        '/api/admin/approvals/templates',
        original,
        routeHeaders(requesterSeed, 'SUPER_ADMIN'),
      );
    }
  }, 120_000);

  it('executes approved workflow creation from the admin approval queue', async () => {
    if (!serverAvailable) return;

    const action = `workflow.create`;
    const procedure = `TEST_WORKFLOW_${Date.now()}`;
    const createRes = await makeRequest(
      'POST',
      '/api/admin/approvals',
      {
        action,
        tenantId: requesterSeed.tenant.id,
        targetType: 'WorkflowDefinition',
        targetId: procedure,
        summary: 'Create workflow from approved queue item',
        payload: {
          name: `Integration Workflow ${Date.now()}`,
          module: 'LEASING',
          procedure,
          description: 'Created from approval execution test',
          tenantId: requesterSeed.tenant.id,
        },
        requiredApprovals: 2,
      },
      routeHeaders(requesterSeed, 'TENANT_ADMIN'),
    );
    expect(createRes.status).toBe(201);
    const approval = await createRes.json() as { id: string };
    createdApprovalIds.push(approval.id);

    const approvalState = await prisma.$queryRawUnsafe<Array<{ required_approvals: number; approval_policy_json: { template?: string; quorum?: { requiredApprovals?: number } } | null }>>(
      `SELECT required_approvals, approval_policy_json
         FROM admin_approval_requests
        WHERE id = $1::uuid
        LIMIT 1`,
      approval.id,
    );
    expect(approvalState[0]?.required_approvals).toBe(1);
    expect(approvalState[0]?.approval_policy_json).toMatchObject({
      template: 'workflow-create',
      quorum: { requiredApprovals: 1 },
    });

    const voteOne = await makeRequest(
      'POST',
      `/api/admin/approvals/${approval.id}/vote`,
      { decision: 'APPROVE' },
      approverOne.headers,
    );
    expect(voteOne.status).toBe(200);
    const voteBody = await voteOne.json();
    expect(voteBody).toMatchObject({
      status: 'APPROVED',
      requiredApprovals: 1,
      execution: {
        ok: true,
        action: 'workflow.create',
        entityType: 'WorkflowDefinition',
      },
    });

    const executeBody = voteBody.execution;
    expect(executeBody).toMatchObject({
      ok: true,
      action: 'workflow.create',
      entityType: 'WorkflowDefinition',
    });

    const workflow = await (prisma as any).workflowDefinition.findUnique({
      where: { id: executeBody.entityId },
      select: { id: true, procedure: true, tenantId: true },
    });
    expect(workflow).toMatchObject({
      id: executeBody.entityId,
      procedure,
      tenantId: requesterSeed.tenant.id,
    });

    const approvalAfter = await prisma.$queryRawUnsafe<Array<{ execution_status: string | null }>>(
      `SELECT execution_status
         FROM admin_approval_requests
        WHERE id = $1::uuid
        LIMIT 1`,
      approval.id,
    );
    expect(approvalAfter[0]?.execution_status).toBe('EXECUTED');
  }, 120_000);

  it('uses a one-vote policy for service config rules updates', async () => {
    if (!serverAvailable) return;

    const createRes = await makeRequest(
      'POST',
      '/api/admin/approvals',
      {
        action: 'service_config.rules.update',
        tenantId: requesterSeed.tenant.id,
        targetType: 'ServiceRules',
        targetId: `rules-${Date.now()}`,
        summary: 'Update approval rules for leasing credit approval',
        payload: {
          category: 'approval',
          scopeId: '74608177-5422-465b-9dcd-347c6009d264',
          rules: {
            approvalRequired: true,
            approvalLevels: 1,
            approverRoles: ['TENANT_ADMIN'],
            workflowId: `wf-${Date.now()}`,
          },
        },
      },
      routeHeaders(requesterSeed, 'TENANT_ADMIN'),
    );
    expect(createRes.status).toBe(201);
    const approval = await createRes.json() as { id: string };
    createdApprovalIds.push(approval.id);

    const approvalState = await prisma.$queryRawUnsafe<Array<{ required_approvals: number; approval_policy_json: { template?: string; quorum?: { requiredApprovals?: number } } | null }>>(
      `SELECT required_approvals, approval_policy_json
         FROM admin_approval_requests
        WHERE id = $1::uuid
        LIMIT 1`,
      approval.id,
    );
    expect(approvalState[0]?.required_approvals).toBe(1);
    expect(approvalState[0]?.approval_policy_json).toMatchObject({
      template: 'service-config-rules-change',
      quorum: { requiredApprovals: 1 },
    });
  }, 120_000);
});
