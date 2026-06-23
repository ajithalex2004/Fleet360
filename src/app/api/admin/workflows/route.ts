import { NextRequest, NextResponse } from 'next/server';
import { listWorkflows, createWorkflow, recordWorkflowNotificationEvent, snapshotWorkflowVersion } from '@/lib/workflow-db';
import { requireAdminPermission, resolveTenantBoundary } from '@/lib/admin-policy';
import { recordAdminChange } from '@/lib/admin-change-history';
import { prisma } from '@/lib/prisma';

async function findActorEmail(userId: string) {
  const user = await prisma.user.findUnique({
    where: { id: userId },
    select: { email: true },
  }).catch(() => null);
  return user?.email ?? null;
}

export async function GET(req: NextRequest) {
  try {
    const auth = await requireAdminPermission(req, 'view', 'workflows');
    if (auth instanceof NextResponse) return auth;

    const { searchParams } = new URL(req.url);
    const requestedTenantId = searchParams.get('tenantId');
    const lite = searchParams.get('lite') === '1';
    const scopedTenantId = auth.ctx.isSuperAdmin && !requestedTenantId
      ? undefined
      : resolveTenantBoundary(auth.ctx, requestedTenantId);
    if (scopedTenantId instanceof NextResponse) return scopedTenantId;

    const workflows = await listWorkflows({
      module:        searchParams.get('module')        ?? undefined,
      // Phase 2 — canonical filters; the Workflow + Approval tabs use
      // serviceTypeId/tenantId so they only see workflows for the picked
      // service. Legacy (NULL serviceTypeId) rows are filtered client-side
      // by the tab via a procedure-key fallback.
      serviceTypeId: searchParams.get('serviceTypeId') ?? undefined,
      tenantId:      scopedTenantId,
      lite,
      reconcile: !lite,
    });
    return NextResponse.json(workflows);
  } catch (e: unknown) {
    return NextResponse.json({ error: e instanceof Error ? e.message : String(e) }, { status: 500 });
  }
}

export async function POST(req: NextRequest) {
  try {
    const auth = await requireAdminPermission(req, 'create', 'workflows');
    if (auth instanceof NextResponse) return auth;

    const body = await req.json();
    const { name, module, procedure, description, serviceTypeId, tenantId, scopeId } = body;
    if (!name || !module || !procedure) {
      return NextResponse.json({ error: 'name, module and procedure are required' }, { status: 400 });
    }
    const scopedTenantId = resolveTenantBoundary(auth.ctx, tenantId ?? null);
    if (scopedTenantId instanceof NextResponse) return scopedTenantId;

    // Draft workflow creation is part of normal configuration authoring.
    // Gating it behind admin approvals made the "Create workflow" action look
    // broken in Service Configuration because no draft existed until a
    // separate approver executed the queue item. Keep audit coverage here and
    // reserve approval gates for riskier operations such as publish/delete.

    const id = await createWorkflow({
      name, module, procedure, description,
      serviceTypeId: serviceTypeId ?? null,
      tenantId:      scopedTenantId,
      scopeId:       scopeId ?? null,
      status: 'DRAFT',
    });
    await snapshotWorkflowVersion({
      workflowId: id,
      createdBy: auth.ctx.userId,
      status: 'DRAFT',
      changeSummary: 'Initial workflow draft created',
    });
    await recordAdminChange({
      req,
      ctx: auth.ctx,
      tenantId: scopedTenantId,
      entityType: 'WorkflowDefinition',
      entityId: id,
      entityName: name,
      action: 'CREATE',
      after: { name, module, procedure, serviceTypeId: serviceTypeId ?? null, tenantId: scopedTenantId, scopeId: scopeId ?? null },
      summary: `Created workflow ${name}.`,
    });
    const actorEmail = await findActorEmail(auth.ctx.userId);
    if (actorEmail) {
      await recordWorkflowNotificationEvent({
        workflowId: id,
        tenantId: scopedTenantId ?? null,
        channel: 'IN_APP',
        event: 'WORKFLOW_CREATED',
        severity: 'success',
        title: `Workflow created: ${name}`,
        message: `${name} was created in draft mode for ${module}/${procedure}.`,
        recipientEmail: actorEmail,
        payload: {
          workflowId: id,
          serviceTypeId: serviceTypeId ?? null,
          scopeId: scopeId ?? null,
          module,
          procedure,
        },
      }).catch(() => undefined);
    }
    return NextResponse.json({ id }, { status: 201 });
  } catch (e: unknown) {
    return NextResponse.json({ error: e instanceof Error ? e.message : String(e) }, { status: 500 });
  }
}
