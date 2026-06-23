import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import type { AdminContext } from '@/lib/admin-auth';
import { recordAdminChange } from '@/lib/admin-change-history';
import {
  buildAdminApprovalPolicy,
  ensureAdminApprovalPolicyTemplateTable,
  resolveAdminApprovalPolicyTemplate,
  type ApprovalPolicySnapshot,
} from '@/lib/admin-approval-policy';
import { notifyAdminApprovalEvent } from '@/lib/admin-approval-notifications';

export type AdminApprovalStatus = 'PENDING' | 'APPROVED' | 'REJECTED' | 'CANCELLED';

let adminApprovalsEnsured = false;
let adminApprovalsEnsurePromise: Promise<void> | null = null;

export async function ensureAdminApprovalTables() {
  if (adminApprovalsEnsured) return;
  if (adminApprovalsEnsurePromise) {
    await adminApprovalsEnsurePromise;
    return;
  }
  adminApprovalsEnsurePromise = (async () => {
  await ensureAdminApprovalPolicyTemplateTable();
  await prisma.$executeRawUnsafe(`
    CREATE TABLE IF NOT EXISTS admin_approval_requests (
      id                 UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      tenant_id          TEXT,
      action             TEXT NOT NULL,
      target_type        TEXT,
      target_id          TEXT,
      summary            TEXT,
      payload_json       JSONB,
      status             TEXT NOT NULL DEFAULT 'PENDING',
      required_approvals INTEGER NOT NULL DEFAULT 2,
      requested_by       TEXT NOT NULL,
      requested_role     TEXT,
      impersonated_by    TEXT,
      decided_at         TIMESTAMPTZ,
      created_at         TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at         TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `);
  await prisma.$executeRawUnsafe(`
    CREATE TABLE IF NOT EXISTS admin_approval_votes (
      id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      approval_request_id UUID NOT NULL REFERENCES admin_approval_requests(id) ON DELETE CASCADE,
      actor_user_id       TEXT NOT NULL,
      actor_role          TEXT,
      decision            TEXT NOT NULL,
      note                TEXT,
      created_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      UNIQUE(approval_request_id, actor_user_id)
    )
  `);
  await prisma.$executeRawUnsafe(`ALTER TABLE admin_approval_requests ADD COLUMN IF NOT EXISTS risk_level TEXT`).catch(() => {});
  await prisma.$executeRawUnsafe(`ALTER TABLE admin_approval_requests ADD COLUMN IF NOT EXISTS approval_policy_json JSONB`).catch(() => {});
  await prisma.$executeRawUnsafe(`ALTER TABLE admin_approval_requests ADD COLUMN IF NOT EXISTS quorum_policy_json JSONB`).catch(() => {});
  await prisma.$executeRawUnsafe(`ALTER TABLE admin_approval_requests ADD COLUMN IF NOT EXISTS due_at TIMESTAMPTZ`).catch(() => {});
  await prisma.$executeRawUnsafe(`ALTER TABLE admin_approval_requests ADD COLUMN IF NOT EXISTS escalation_at TIMESTAMPTZ`).catch(() => {});
  await prisma.$executeRawUnsafe(`ALTER TABLE admin_approval_requests ADD COLUMN IF NOT EXISTS execution_status TEXT`).catch(() => {});
  await prisma.$executeRawUnsafe(`ALTER TABLE admin_approval_requests ADD COLUMN IF NOT EXISTS executed_at TIMESTAMPTZ`).catch(() => {});
  await prisma.$executeRawUnsafe(`ALTER TABLE admin_approval_requests ADD COLUMN IF NOT EXISTS executed_by TEXT`).catch(() => {});
  await prisma.$executeRawUnsafe(`ALTER TABLE admin_approval_requests ADD COLUMN IF NOT EXISTS execution_result_json JSONB`).catch(() => {});
  await prisma.$executeRawUnsafe(`
    CREATE INDEX IF NOT EXISTS idx_admin_approval_requests_status
    ON admin_approval_requests(status, created_at DESC)
  `).catch(() => {});
  await prisma.$executeRawUnsafe(`
    CREATE INDEX IF NOT EXISTS idx_admin_approval_requests_tenant
    ON admin_approval_requests(tenant_id, created_at DESC)
  `).catch(() => {});
  await prisma.$executeRawUnsafe(`
    CREATE INDEX IF NOT EXISTS idx_admin_approval_requests_sla
    ON admin_approval_requests(status, due_at, escalation_at)
  `).catch(() => {});
  await prisma.$executeRawUnsafe(`
    CREATE INDEX IF NOT EXISTS idx_admin_approval_requests_execution
    ON admin_approval_requests(execution_status, executed_at DESC)
  `).catch(() => {});
  await prisma.$executeRawUnsafe(`
    UPDATE admin_approval_requests
       SET required_approvals = 1,
           approval_policy_json = CASE
             WHEN approval_policy_json IS NULL THEN NULL
             ELSE jsonb_set(
               jsonb_set(approval_policy_json, '{requiredApprovals}', '1'::jsonb, true),
               '{quorum,requiredApprovals}',
               '1'::jsonb,
               true
             )
           END,
           updated_at = NOW()
     WHERE lower(action) LIKE 'workflow%'
       AND required_approvals <> 1
  `).catch(() => {});
  await prisma.$executeRawUnsafe(`
    UPDATE admin_approval_requests AS request
       SET status = 'APPROVED',
           decided_at = COALESCE(request.decided_at, NOW()),
           updated_at = NOW()
      FROM (
        SELECT approval_request_id,
               COUNT(*) FILTER (WHERE decision = 'APPROVE') AS approvals,
               COUNT(*) FILTER (WHERE decision = 'REJECT') AS rejections
          FROM admin_approval_votes
         GROUP BY approval_request_id
      ) AS votes
     WHERE request.id = votes.approval_request_id
       AND lower(request.action) LIKE 'workflow%'
       AND request.status = 'PENDING'
       AND COALESCE(votes.rejections, 0) = 0
       AND COALESCE(votes.approvals, 0) >= request.required_approvals
  `).catch(() => {});
  })();
  try {
    await adminApprovalsEnsurePromise;
    adminApprovalsEnsured = true;
  } finally {
    adminApprovalsEnsurePromise = null;
  }
}

function safeJson(value: unknown) {
  if (value === undefined) return null;
  return JSON.stringify(value, (_key, nested) => typeof nested === 'bigint' ? Number(nested) : nested);
}

export function normalizeRequiredApprovals(value: unknown) {
  const parsed = Number(value ?? 2);
  if (!Number.isFinite(parsed)) return 2;
  return Math.max(1, Math.min(Math.floor(parsed), 10));
}

export async function createAdminApprovalRequest(args: {
  req: NextRequest;
  ctx: AdminContext;
  action: string;
  tenantId?: string | null;
  targetType?: string | null;
  targetId?: string | null;
  summary?: string | null;
  payload?: unknown;
  requiredApprovals?: number;
}) {
  await ensureAdminApprovalTables();
  const impersonatedBy = args.req.headers.get('x-impersonated-by');
  const tenantId = args.tenantId ?? args.ctx.tenantId ?? null;
  const template = await resolveAdminApprovalPolicyTemplate(args.action);
  const policy = buildAdminApprovalPolicy({
    action: args.action,
    template,
    tenantId,
    impersonatedBy,
    payload: args.payload,
    requiredApprovals: args.requiredApprovals,
  });
  const requiredApprovals = policy.requiredApprovals;
  const rows = await prisma.$queryRawUnsafe<Array<{ id: string }>>(
    `INSERT INTO admin_approval_requests
       (tenant_id, action, target_type, target_id, summary, payload_json,
        required_approvals, requested_by, requested_role, impersonated_by,
        risk_level, approval_policy_json, quorum_policy_json, due_at, escalation_at)
     VALUES ($1,$2,$3,$4,$5,$6::jsonb,$7,$8,$9,$10,$11,$12::jsonb,$13::jsonb,$14::timestamptz,$15::timestamptz)
     RETURNING id::text`,
    tenantId,
    args.action,
    args.targetType ?? null,
    args.targetId ?? null,
    args.summary ?? null,
    safeJson(args.payload),
    requiredApprovals,
    args.ctx.userId,
    args.ctx.role,
    impersonatedBy ?? null,
    policy.risk,
    safeJson(policy),
    safeJson(policy.quorum),
    policy.sla.dueAt,
    policy.sla.escalationAt,
  );
  const id = rows[0]?.id;
  await recordAdminChange({
    req: args.req,
    ctx: args.ctx,
    tenantId,
    entityType: 'AdminApprovalRequest',
    entityId: id,
    action: 'CREATE',
    after: {
      action: args.action,
      targetType: args.targetType ?? null,
      targetId: args.targetId ?? null,
      status: 'PENDING',
      requiredApprovals,
      summary: args.summary ?? null,
      impersonatedBy: impersonatedBy ?? null,
      policy,
    },
    summary: `Requested approval for ${args.action}: ${args.summary ?? ''}`.trim(),
  });
  await notifyAdminApprovalEvent({
    approvalId: id,
    tenantId,
    requesterId: args.ctx.userId,
    action: args.action,
    summary: args.summary ?? null,
    event: 'REQUESTED',
    policy,
  });
  return id;
}

export async function getApprovalState(id: string) {
  await ensureAdminApprovalTables();
  const rows = await prisma.$queryRawUnsafe<Array<{
    id: string;
    tenant_id: string | null;
    action: string;
    status: AdminApprovalStatus;
    required_approvals: number;
    requested_by: string;
    risk_level: string | null;
    approval_policy_json: ApprovalPolicySnapshot | null;
    due_at: string | null;
    escalation_at: string | null;
    execution_status: string | null;
    executed_at: string | null;
    executed_by: string | null;
    execution_result_json: unknown | null;
    approvals: bigint;
    rejections: bigint;
  }>>(
    `SELECT r.id::text, r.tenant_id, r.action, r.status, r.required_approvals, r.requested_by,
            r.risk_level, r.approval_policy_json, r.due_at::text, r.escalation_at::text,
            r.execution_status, r.executed_at::text, r.executed_by, r.execution_result_json,
            COUNT(v.id) FILTER (WHERE v.decision = 'APPROVE') AS approvals,
            COUNT(v.id) FILTER (WHERE v.decision = 'REJECT') AS rejections
       FROM admin_approval_requests r
       LEFT JOIN admin_approval_votes v ON v.approval_request_id = r.id
      WHERE r.id = $1::uuid
      GROUP BY r.id`,
    id,
  ).catch(() => []);
  return rows[0] ?? null;
}

export async function requireApprovedAdminAction(
  req: NextRequest,
  ctx: AdminContext,
  action: string,
  details?: {
    tenantId?: string | null;
    targetType?: string | null;
    targetId?: string | null;
    summary?: string | null;
    payload?: unknown;
    requiredApprovals?: number;
  },
): Promise<NextResponse | null> {
  const approvalId = req.headers.get('x-admin-approval-id') ?? '';
  if (approvalId) {
    const state = await getApprovalState(approvalId);
    if (!state || state.action !== action) {
      return NextResponse.json({ error: 'Invalid approval request' }, { status: 428 });
    }
    if (state.status !== 'APPROVED') {
      return NextResponse.json({ error: 'Approval is not complete', approvalRequest: state }, { status: 428 });
    }
    if (state.requested_by !== ctx.userId && !ctx.isSuperAdmin) {
      return NextResponse.json({ error: 'Approval request belongs to another actor' }, { status: 403 });
    }
    await markAdminApprovalExecuted(req, ctx, approvalId, {
      status: 'EXECUTED',
      action,
      executedVia: 'x-admin-approval-id',
    });
    return null;
  }

  await ensureAdminApprovalTables();
  const tenantId = details?.tenantId ?? ctx.tenantId ?? null;
  const targetType = details?.targetType ?? null;
  const targetId = details?.targetId ?? null;
  const recent = await prisma.$queryRawUnsafe<Array<{
    id: string;
    status: AdminApprovalStatus;
    required_approvals: number;
    risk_level: string | null;
    approval_policy_json: ApprovalPolicySnapshot | null;
    due_at: string | null;
    escalation_at: string | null;
    approvals: bigint;
    rejections: bigint;
  }>>(
    `SELECT r.id::text, r.status, r.required_approvals,
            r.risk_level, r.approval_policy_json, r.due_at::text, r.escalation_at::text,
            COUNT(v.id) FILTER (WHERE v.decision = 'APPROVE') AS approvals,
            COUNT(v.id) FILTER (WHERE v.decision = 'REJECT') AS rejections
       FROM admin_approval_requests r
       LEFT JOIN admin_approval_votes v ON v.approval_request_id = r.id
      WHERE r.action = $1
        AND r.requested_by = $2
        AND COALESCE(r.tenant_id, '') = COALESCE($3, '')
        AND COALESCE(r.target_type, '') = COALESCE($4, '')
        AND COALESCE(r.target_id, '') = COALESCE($5, '')
        AND r.status IN ('PENDING','APPROVED')
        AND COALESCE(r.execution_status, '') <> 'EXECUTED'
        AND r.created_at > NOW() - INTERVAL '24 hours'
      GROUP BY r.id
      ORDER BY r.created_at DESC
      LIMIT 1`,
    action,
    ctx.userId,
    tenantId,
    targetType,
    targetId,
  ).catch(() => []);

  const matching = recent[0];
  if (matching?.status === 'APPROVED') {
    return NextResponse.json(
      {
        error: 'Approval required',
        action,
        approvalRequest: {
          id: matching.id,
          status: matching.status,
          requiredApprovals: matching.required_approvals,
          approvals: Number(matching.approvals ?? 0),
          risk: matching.risk_level,
          policy: matching.approval_policy_json,
          dueAt: matching.due_at,
          escalationAt: matching.escalation_at,
        },
        message: 'The action is approved. Retry with x-admin-approval-id to execute it.',
      },
      { status: 428 },
    );
  }
  if (matching?.status === 'PENDING') {
    return NextResponse.json(
      {
        error: 'Approval required',
        action,
        approvalRequest: {
          id: matching.id,
          status: matching.status,
          requiredApprovals: matching.required_approvals,
          approvals: Number(matching.approvals ?? 0),
          risk: matching.risk_level,
          policy: matching.approval_policy_json,
          dueAt: matching.due_at,
          escalationAt: matching.escalation_at,
        },
        message: 'The action is already queued for admin approval. Retry after it is approved.',
      },
      { status: 428 },
    );
  }

  const id = await createAdminApprovalRequest({
    req,
    ctx,
    action,
    ...details,
  });
  const template = await resolveAdminApprovalPolicyTemplate(action);
  const policy = buildAdminApprovalPolicy({
    action,
    template,
    tenantId,
    payload: details?.payload,
    requiredApprovals: details?.requiredApprovals,
  });
  return NextResponse.json(
    {
      error: 'Approval required',
      action,
      approvalRequest: {
        id,
        status: 'PENDING',
        requiredApprovals: policy.requiredApprovals,
        risk: policy.risk,
        policy,
        dueAt: policy.sla.dueAt,
        escalationAt: policy.sla.escalationAt,
      },
      message: 'The action was queued for admin approval. Retry with x-admin-approval-id after it is approved.',
    },
    { status: 428 },
  );
}

export async function markAdminApprovalExecuted(
  req: NextRequest,
  ctx: AdminContext,
  approvalId: string,
  result: unknown,
) {
  await ensureAdminApprovalTables();
  const before = await getApprovalState(approvalId);
  await prisma.$executeRawUnsafe(
    `UPDATE admin_approval_requests
        SET execution_status = 'EXECUTED',
            executed_at = COALESCE(executed_at, NOW()),
            executed_by = COALESCE(executed_by, $2),
            execution_result_json = $3::jsonb,
            updated_at = NOW()
      WHERE id = $1::uuid
        AND status = 'APPROVED'`,
    approvalId,
    ctx.userId,
    safeJson(result),
  );
  const after = await getApprovalState(approvalId);
  await recordAdminChange({
    req,
    ctx,
    tenantId: after?.tenant_id ?? before?.tenant_id ?? ctx.tenantId,
    entityType: 'AdminApprovalRequest',
    entityId: approvalId,
    action: 'EXECUTE',
    before,
    after: {
      ...after,
      executionStatus: 'EXECUTED',
      executionResult: result,
    },
    summary: `Executed approved admin request ${approvalId}.`,
  });
  if (after) {
    await notifyAdminApprovalEvent({
      approvalId,
      tenantId: after.tenant_id,
      requesterId: ctx.userId,
      action: after.action,
      summary: `Executed approved admin request ${approvalId}.`,
      event: 'EXECUTED',
      policy: after.approval_policy_json,
    });
  }
}
