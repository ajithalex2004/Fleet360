import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { requireAdminPermission, resolveTenantBoundary } from '@/lib/admin-policy';
import { createAdminApprovalRequest, ensureAdminApprovalTables } from '@/lib/admin-approvals';
import { buildAdminApprovalPolicy, resolveAdminApprovalPolicyTemplate } from '@/lib/admin-approval-policy';

function approvalGovernance(row: Record<string, unknown>) {
  const storedPolicy = row.approval_policy_json && typeof row.approval_policy_json === 'object'
    ? row.approval_policy_json as Record<string, unknown>
    : null;
  const computedPolicy = buildAdminApprovalPolicy({
    action: String(row.action ?? ''),
    tenantId: row.tenant_id ? String(row.tenant_id) : null,
    impersonatedBy: row.impersonated_by ? String(row.impersonated_by) : null,
    payload: row.payload_json,
    requiredApprovals: Number(row.required_approvals ?? 1),
    createdAt: row.created_at as string | null,
    dueAt: row.due_at as string | null,
    escalationAt: row.escalation_at as string | null,
  });
  return {
    ...computedPolicy,
    ...(storedPolicy ?? {}),
    sla: {
      ...computedPolicy.sla,
      ...((storedPolicy?.sla && typeof storedPolicy.sla === 'object') ? storedPolicy.sla as Record<string, unknown> : {}),
      status: computedPolicy.sla.status,
    },
  };
}

export async function GET(req: NextRequest) {
  const auth = await requireAdminPermission(req, 'view', 'audit');
  if (auth instanceof NextResponse) return auth;

  await ensureAdminApprovalTables();
  const { searchParams } = new URL(req.url);
  const status = searchParams.get('status') ?? '';
  const requestedTenantId = searchParams.get('tenantId');
  const scopedTenantId = auth.ctx.isSuperAdmin && !requestedTenantId
    ? ''
    : resolveTenantBoundary(auth.ctx, requestedTenantId);
  if (scopedTenantId instanceof NextResponse) return scopedTenantId;

  const conditions: string[] = [];
  const values: unknown[] = [];
  if (scopedTenantId) {
    values.push(scopedTenantId);
    conditions.push(`r.tenant_id = $${values.length}`);
  }
  if (status) {
    values.push(status.toUpperCase());
    conditions.push(`r.status = $${values.length}`);
  }
  values.push(auth.ctx.userId);
  const actorDecisionParam = values.length;
  const where = conditions.length ? `WHERE ${conditions.join(' AND ')}` : '';

  const rows = await prisma.$queryRawUnsafe<Array<Record<string, unknown>>>(
    `SELECT r.id::text, r.tenant_id, r.action, r.target_type, r.target_id,
            r.summary, r.payload_json, r.status, r.required_approvals,
            r.requested_by, u.email AS requested_by_email,
            r.requested_role, r.impersonated_by, r.created_at::text, r.updated_at::text,
            r.risk_level, r.approval_policy_json, r.quorum_policy_json,
            r.due_at::text, r.escalation_at::text,
            r.execution_status, r.executed_at::text, r.executed_by, r.execution_result_json,
            COALESCE(v.approvals, 0)::int AS approvals,
            COALESCE(v.rejections, 0)::int AS rejections,
            me.decision AS actor_decision,
            (r.requested_by = $${actorDecisionParam}) AS is_requester
       FROM admin_approval_requests r
       LEFT JOIN "User" u ON u.id = r.requested_by
       LEFT JOIN LATERAL (
         SELECT COUNT(*) FILTER (WHERE decision = 'APPROVE') AS approvals,
                COUNT(*) FILTER (WHERE decision = 'REJECT') AS rejections
           FROM admin_approval_votes
          WHERE approval_request_id = r.id
       ) v ON TRUE
       LEFT JOIN LATERAL (
         SELECT decision
           FROM admin_approval_votes
          WHERE approval_request_id = r.id
            AND actor_user_id = $${actorDecisionParam}
          LIMIT 1
       ) me ON TRUE
       ${where}
      ORDER BY r.created_at DESC
      LIMIT 200`,
    ...values,
  );

  return NextResponse.json({
    approvals: rows.map(row => ({
      ...row,
      governance: approvalGovernance(row),
    })),
  });
}

export async function POST(req: NextRequest) {
  const auth = await requireAdminPermission(req, 'create', 'audit');
  if (auth instanceof NextResponse) return auth;

  const body = await req.json().catch(() => ({}));
  const action = String(body.action ?? '').trim();
  if (!action) return NextResponse.json({ error: 'action is required' }, { status: 400 });

  const tenantId = body.tenantId ? resolveTenantBoundary(auth.ctx, String(body.tenantId)) : auth.ctx.tenantId;
  if (tenantId instanceof NextResponse) return tenantId;

  const id = await createAdminApprovalRequest({
    req,
    ctx: auth.ctx,
    action,
    tenantId,
    targetType: body.targetType ?? null,
    targetId: body.targetId ?? null,
    summary: body.summary ?? null,
    payload: body.payload ?? null,
    requiredApprovals: body.requiredApprovals,
  });
  const template = await resolveAdminApprovalPolicyTemplate(action);
  const governance = buildAdminApprovalPolicy({
    action,
    template,
    tenantId,
    payload: body.payload ?? null,
    requiredApprovals: body.requiredApprovals,
    impersonatedBy: req.headers.get('x-impersonated-by'),
  });

  return NextResponse.json({ id, status: 'PENDING', requiredApprovals: governance.requiredApprovals, governance }, { status: 201 });
}
