import { NextRequest, NextResponse } from 'next/server';
import { getWorkflowWithSteps, updateWorkflow, deleteWorkflow, recordWorkflowNotificationEvent } from '@/lib/workflow-db';
import { requireDangerApproval } from '@/lib/admin-policy';
import { recordAdminChange } from '@/lib/admin-change-history';
import { requireWorkflowAccess } from '@/lib/admin-workflow-policy';
import { prisma } from '@/lib/prisma';

function errorMessage(error: unknown) {
  return error instanceof Error ? error.message : String(error);
}

async function findActorEmail(userId: string) {
  const user = await prisma.user.findUnique({
    where: { id: userId },
    select: { email: true },
  }).catch(() => null);
  return user?.email ?? null;
}

export async function GET(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await params;
    const auth = await requireWorkflowAccess(req, 'view', id);
    if (auth instanceof NextResponse) return auth;
    const wf = await getWorkflowWithSteps(id);
    if (!wf) return NextResponse.json({ error: 'Not found' }, { status: 404 });
    return NextResponse.json(wf);
  } catch (e: unknown) {
    return NextResponse.json({ error: errorMessage(e) }, { status: 500 });
  }
}

export async function PUT(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await params;
    const auth = await requireWorkflowAccess(req, 'edit', id);
    if (auth instanceof NextResponse) return auth;
    const before = await getWorkflowWithSteps(id);
    const body = await req.json();
    await updateWorkflow(id, body);
    const after = before ? { ...before, ...body } : body;
    await recordAdminChange({
      req,
      ctx: auth.ctx,
      tenantId: auth.workflow.tenantId,
      entityType: 'WorkflowDefinition',
      entityId: id,
      entityName: String((after as { name?: string } | null)?.name ?? before?.name ?? id),
      action: 'UPDATE',
      before,
      after,
      summary: `Updated workflow ${String((after as { name?: string } | null)?.name ?? id)}.`,
    });
    return NextResponse.json({ success: true });
  } catch (e: unknown) {
    return NextResponse.json({ error: errorMessage(e) }, { status: 500 });
  }
}

export async function DELETE(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await params;
    const auth = await requireWorkflowAccess(req, 'delete', id);
    if (auth instanceof NextResponse) return auth;
    const before = await getWorkflowWithSteps(id);
    const approval = await requireDangerApproval(req, auth.ctx, 'workflow.delete', {
      tenantId: auth.workflow.tenantId,
      targetType: 'WorkflowDefinition',
      targetId: id,
      summary: `Delete workflow ${before?.name ?? id}.`,
    });
    if (approval) return approval;
    await deleteWorkflow(id);
    await recordAdminChange({
      req,
      ctx: auth.ctx,
      tenantId: auth.workflow.tenantId,
      entityType: 'WorkflowDefinition',
      entityId: id,
      entityName: before?.name,
      action: 'DELETE',
      before,
      summary: `Deleted workflow ${before?.name ?? id}.`,
    });
    const actorEmail = await findActorEmail(auth.ctx.userId);
    if (actorEmail) {
      await recordWorkflowNotificationEvent({
        workflowId: id,
        tenantId: auth.workflow.tenantId ?? null,
        channel: 'IN_APP',
        event: 'WORKFLOW_DELETED',
        severity: 'warning',
        title: `Workflow deleted: ${before?.name ?? id}`,
        message: `${before?.name ?? id} was removed from workflow management.`,
        recipientEmail: actorEmail,
        payload: {
          workflowId: id,
          module: before?.module ?? null,
          procedure: before?.procedure ?? null,
        },
      }).catch(() => undefined);
    }
    return NextResponse.json({ success: true });
  } catch (e: unknown) {
    return NextResponse.json({ error: errorMessage(e) }, { status: 500 });
  }
}
