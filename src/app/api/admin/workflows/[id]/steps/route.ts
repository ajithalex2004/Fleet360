import { NextRequest, NextResponse } from 'next/server';
import { listSteps, createStep, snapshotWorkflowVersion } from '@/lib/workflow-db';
import { requireDangerApproval } from '@/lib/admin-policy';
import { recordAdminChange } from '@/lib/admin-change-history';
import { requireWorkflowAccess } from '@/lib/admin-workflow-policy';

function errorMessage(error: unknown) {
  return error instanceof Error ? error.message : String(error);
}

export async function GET(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await params;
    const auth = await requireWorkflowAccess(req, 'view', id);
    if (auth instanceof NextResponse) return auth;
    const steps = await listSteps(id);
    return NextResponse.json(steps);
  } catch (e: unknown) {
    return NextResponse.json({ error: errorMessage(e) }, { status: 500 });
  }
}

export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await params;
    const auth = await requireWorkflowAccess(req, 'edit', id);
    if (auth instanceof NextResponse) return auth;
    const body = await req.json();
    const approval = await requireDangerApproval(req, auth.ctx, 'workflow.step.create', {
      tenantId: auth.workflow.tenantId,
      targetType: 'WorkflowStep',
      targetId: id,
      summary: `Create workflow step ${body.stepName ?? 'new step'}.`,
      payload: { workflowId: id, ...body },
    });
    if (approval) return approval;
    const stepId = await createStep(id, body);
    await snapshotWorkflowVersion({
      workflowId: id,
      createdBy: auth.ctx.userId,
      status: 'DRAFT',
      changeSummary: `Added workflow step ${body.stepName ?? stepId}`,
    });
    await recordAdminChange({
      req,
      ctx: auth.ctx,
      tenantId: auth.workflow.tenantId,
      entityType: 'WorkflowStep',
      entityId: stepId,
      action: 'CREATE',
      after: { workflowId: id, ...body },
      summary: `Created workflow step ${body.stepName ?? stepId}.`,
    });
    return NextResponse.json({ id: stepId }, { status: 201 });
  } catch (e: unknown) {
    return NextResponse.json({ error: errorMessage(e) }, { status: 500 });
  }
}
