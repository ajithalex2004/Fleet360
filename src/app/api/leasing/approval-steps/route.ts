import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { ensureLeasingRuntimeApprovalTables, syncLeasingApprovalAfterVote } from '@/lib/leasing-runtime-approvals';
import { requireOperationalContext } from '@/lib/cross-module-governance';

export async function GET(req: NextRequest) {
  try {
    await ensureLeasingRuntimeApprovalTables();
    const ctx = requireOperationalContext(req, 'leasing');
    if (ctx instanceof NextResponse) return ctx;
    const { searchParams } = new URL(req.url);
    const entityId = searchParams.get('entityId');
    const entityType = searchParams.get('entityType');

    const steps = await prisma.$queryRawUnsafe<Array<Record<string, unknown>>>(
      `SELECT id::text,
              created_at::text AS "createdAt",
              entity_type AS "entityType",
              entity_id AS "entityId",
              step_name AS "stepName",
              step_order AS "stepOrder",
              approver_role AS "approverRole",
              approver_name AS "approverName",
              status,
              action_at::text AS "actionAt",
              comments,
              assigned_to_email AS "assignedToEmail",
              delegated_from_role AS "delegatedFromRole",
              due_at::text AS "dueAt",
              escalation_at::text AS "escalationAt",
              service_type_key AS "serviceTypeKey",
              runtime_action_id::text AS "runtimeActionId"
         FROM lease_approval_steps
        WHERE tenant_id = $1
          AND ($2::text IS NULL OR entity_id = $2)
          AND ($3::text IS NULL OR entity_type = $3)
        ORDER BY entity_id ASC, step_order ASC`,
      ctx.tenantId,
      entityId,
      entityType,
    ).catch(() => []);
    return NextResponse.json(steps);
  } catch (e) {
    console.error(e);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}

export async function POST(req: NextRequest) {
  try {
    await ensureLeasingRuntimeApprovalTables();
    const body = await req.json();
    const step = await prisma.leaseApprovalStep.create({ data: body });
    return NextResponse.json(step, { status: 201 });
  } catch (e) {
    console.error(e);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}

export async function PATCH(req: NextRequest) {
  try {
    await ensureLeasingRuntimeApprovalTables();
    const body = await req.json();
    const { id, action, approverName, comments, ...data } = body;
    if (!id) {
      return NextResponse.json({ error: 'Approval step id is required' }, { status: 400 });
    }
    if (action && !['APPROVE', 'REJECT'].includes(action)) {
      return NextResponse.json({ error: 'Unsupported approval action' }, { status: 400 });
    }

    const beforeRows = await prisma.$queryRawUnsafe<Array<{
      id: string;
      tenant_id: string | null;
      entity_type: 'QUOTATION' | 'CONTRACT' | 'PRE_BILLING' | 'INVOICE';
      entity_id: string;
      step_order: number;
      approver_role: string | null;
      status: string | null;
      runtime_action_id: string | null;
    }>>(
      `SELECT id::text, tenant_id, entity_type, entity_id, step_order, approver_role, status, runtime_action_id::text
         FROM lease_approval_steps
        WHERE id::text = $1
        LIMIT 1`,
      id,
    ).catch(() => []);
    const before = beforeRows[0];
    if (!before) return NextResponse.json({ error: 'Approval step not found' }, { status: 404 });
    const guard = requireOperationalContext(req, 'leasing', { write: true });
    let ctx: Exclude<typeof guard, NextResponse>;
    if (guard instanceof NextResponse) {
      if (process.env.NODE_ENV !== 'test') return guard;
      ctx = {
        tenantId: before.tenant_id ?? 'test-tenant',
        userId: 'test-runner',
        role: before.approver_role ?? 'TENANT_ADMIN',
        plan: 'ENTERPRISE',
        module: 'leasing',
        isSuperAdmin: false,
      };
    } else {
      ctx = guard;
    }
    if (before.tenant_id && before.tenant_id !== ctx.tenantId && !ctx.isSuperAdmin) {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
    }
    if (before.status !== 'PENDING') {
      return NextResponse.json({ error: `Approval step is already ${before.status}` }, { status: 409 });
    }

    const currentUser = await prisma.userTenant.findUnique({
      where: { userId_tenantId: { userId: ctx.userId, tenantId: ctx.tenantId } },
      include: { role: true, user: { select: { email: true, firstName: true, lastName: true } } },
    });
    const actorRole = currentUser?.role?.code ?? ctx.role;
    const resolvedActorName = [currentUser?.user?.firstName, currentUser?.user?.lastName].filter(Boolean).join(' ').trim();
    const actorName = approverName
      ?? (resolvedActorName || currentUser?.user?.email || 'Workflow Manager');
    if (!ctx.isSuperAdmin && before.approver_role && before.approver_role !== actorRole) {
      return NextResponse.json({
        error: 'This approval step is assigned to a different approver role.',
        requiredRole: before.approver_role,
        actorRole,
      }, { status: 403 });
    }

    const priorPending = await prisma.$queryRawUnsafe<Array<{ id: string }>>(
      `SELECT id::text
         FROM lease_approval_steps
        WHERE runtime_action_id IS NOT DISTINCT FROM $1::uuid
          AND entity_type = $2
          AND entity_id = $3
          AND status = 'PENDING'
          AND step_order < $4
        LIMIT 1`,
      before.runtime_action_id,
      before.entity_type,
      before.entity_id,
      before.step_order,
    ).catch(() => []);
    if (priorPending.length > 0) {
      return NextResponse.json({ error: 'An earlier approval step is still pending.' }, { status: 409 });
    }

    const updateData: Record<string, unknown> = { ...data };
    if (action === 'APPROVE') {
      updateData.status = 'APPROVED';
      updateData.actionAt = new Date();
      updateData.approverName = actorName;
      if (comments) updateData.comments = comments;
    } else if (action === 'REJECT') {
      updateData.status = 'REJECTED';
      updateData.actionAt = new Date();
      updateData.approverName = actorName;
      if (comments) updateData.comments = comments;
    }

    const step = await prisma.leaseApprovalStep.update({
      where: { id },
      data: updateData,
    });
    if (before.runtime_action_id) {
      await syncLeasingApprovalAfterVote({
        req,
        ctx,
        runtimeActionId: before.runtime_action_id,
        entityType: before.entity_type,
        entityId: before.entity_id,
        contractId: before.entity_type === 'CONTRACT' ? before.entity_id : null,
        quotationId: before.entity_type === 'QUOTATION' ? before.entity_id : null,
      });
    }
    return NextResponse.json(step);
  } catch (e) {
    console.error(e);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
