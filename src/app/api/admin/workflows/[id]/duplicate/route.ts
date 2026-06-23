import { NextRequest, NextResponse } from 'next/server';
import { duplicateWorkflow, getWorkflowWithSteps } from '@/lib/workflow-db';
import { requireDangerApproval } from '@/lib/admin-policy';
import { recordAdminChange } from '@/lib/admin-change-history';
import { requireWorkflowAccess } from '@/lib/admin-workflow-policy';

function errorMessage(error: unknown) {
  return error instanceof Error ? error.message : String(error);
}

export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await params;
    const auth = await requireWorkflowAccess(req, 'create', id);
    if (auth instanceof NextResponse) return auth;
    const before = await getWorkflowWithSteps(id);
    const approval = await requireDangerApproval(req, auth.ctx, 'workflow.clone', {
      tenantId: auth.workflow.tenantId,
      targetType: 'WorkflowDefinition',
      targetId: id,
      summary: `Clone workflow ${before?.name ?? id}.`,
    });
    if (approval) return approval;
    const newId = await duplicateWorkflow(id);
    const after = await getWorkflowWithSteps(newId);
    await recordAdminChange({
      req,
      ctx: auth.ctx,
      tenantId: auth.workflow.tenantId,
      entityType: 'WorkflowDefinition',
      entityId: newId,
      entityName: after?.name,
      action: 'CREATE',
      before,
      after,
      summary: `Cloned workflow ${before?.name ?? id}.`,
    });
    return NextResponse.json({ id: newId });
  } catch (e: unknown) {
    return NextResponse.json({ error: errorMessage(e) }, { status: 500 });
  }
}
