import { NextRequest, NextResponse } from 'next/server';
import { getWorkflowWithSteps, updateStep, deleteStep, snapshotWorkflowVersion } from '@/lib/workflow-db';
import { requireDangerApproval } from '@/lib/admin-policy';
import { recordAdminChange } from '@/lib/admin-change-history';
import { requireWorkflowAccess } from '@/lib/admin-workflow-policy';

type WorkflowStepSummary = { id: string; stepName?: string | null };

function errorMessage(error: unknown) {
  return error instanceof Error ? error.message : String(error);
}

export async function PUT(req: NextRequest, { params }: { params: Promise<{ id: string; stepId: string }> }) {
  try {
    const { id, stepId } = await params;
    const auth = await requireWorkflowAccess(req, 'edit', id);
    if (auth instanceof NextResponse) return auth;
    const beforeWorkflow = await getWorkflowWithSteps(id);
    const before = (beforeWorkflow?.steps as WorkflowStepSummary[] | undefined)?.find(s => s.id === stepId) ?? null;
    const body = await req.json();
    const approval = await requireDangerApproval(req, auth.ctx, 'workflow.step.update', {
      tenantId: auth.workflow.tenantId,
      targetType: 'WorkflowStep',
      targetId: stepId,
      summary: `Update workflow step ${before?.stepName ?? stepId}.`,
      payload: body,
    });
    if (approval) return approval;
    await updateStep(stepId, body);
    await snapshotWorkflowVersion({
      workflowId: id,
      createdBy: auth.ctx.userId,
      status: 'DRAFT',
      changeSummary: `Updated workflow step ${before?.stepName ?? stepId}`,
    });
    const afterWorkflow = await getWorkflowWithSteps(id);
    const after = (afterWorkflow?.steps as WorkflowStepSummary[] | undefined)?.find(s => s.id === stepId) ?? null;
    await recordAdminChange({
      req,
      ctx: auth.ctx,
      tenantId: auth.workflow.tenantId,
      entityType: 'WorkflowStep',
      entityId: stepId,
      action: 'UPDATE',
      before,
      after,
      summary: `Updated workflow step ${after?.stepName ?? stepId}.`,
    });
    return NextResponse.json({ success: true });
  } catch (e: unknown) {
    return NextResponse.json({ error: errorMessage(e) }, { status: 500 });
  }
}

export async function DELETE(req: NextRequest, { params }: { params: Promise<{ id: string; stepId: string }> }) {
  try {
    const { id, stepId } = await params;
    const auth = await requireWorkflowAccess(req, 'edit', id);
    if (auth instanceof NextResponse) return auth;
    const beforeWorkflow = await getWorkflowWithSteps(id);
    const before = (beforeWorkflow?.steps as WorkflowStepSummary[] | undefined)?.find(s => s.id === stepId) ?? null;
    const approval = await requireDangerApproval(req, auth.ctx, 'workflow.step.delete', {
      tenantId: auth.workflow.tenantId,
      targetType: 'WorkflowStep',
      targetId: stepId,
      summary: `Delete workflow step ${before?.stepName ?? stepId}.`,
    });
    if (approval) return approval;
    await deleteStep(stepId);
    await snapshotWorkflowVersion({
      workflowId: id,
      createdBy: auth.ctx.userId,
      status: 'DRAFT',
      changeSummary: `Deleted workflow step ${before?.stepName ?? stepId}`,
    });
    await recordAdminChange({
      req,
      ctx: auth.ctx,
      tenantId: auth.workflow.tenantId,
      entityType: 'WorkflowStep',
      entityId: stepId,
      action: 'DELETE',
      before,
      summary: `Deleted workflow step ${before?.stepName ?? stepId}.`,
    });
    return NextResponse.json({ success: true });
  } catch (e: unknown) {
    return NextResponse.json({ error: errorMessage(e) }, { status: 500 });
  }
}
