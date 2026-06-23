import { NextRequest, NextResponse } from 'next/server';
import { getWorkflowWithSteps, listWorkflowVersions, rollbackWorkflowToVersion } from '@/lib/workflow-db';
import { requireWorkflowAccess } from '@/lib/admin-workflow-policy';
import { requireDangerApproval } from '@/lib/admin-policy';
import { recordAdminChange } from '@/lib/admin-change-history';

function errorMessage(error: unknown) {
  return error instanceof Error ? error.message : String(error);
}

export async function GET(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await params;
    const auth = await requireWorkflowAccess(req, 'view', id);
    if (auth instanceof NextResponse) return auth;
    const versions = await listWorkflowVersions(id);
    return NextResponse.json(versions);
  } catch (e: unknown) {
    return NextResponse.json({ error: errorMessage(e) }, { status: 500 });
  }
}

export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await params;
    const auth = await requireWorkflowAccess(req, 'edit', id);
    if (auth instanceof NextResponse) return auth;
    const body = await req.json().catch(() => ({}));
    if (body.action !== 'rollback' || !body.versionId) {
      return NextResponse.json({ error: 'action=rollback and versionId are required' }, { status: 400 });
    }

    const before = await getWorkflowWithSteps(id);
    const approval = await requireDangerApproval(req, auth.ctx, 'workflow.version.rollback', {
      tenantId: auth.workflow.tenantId,
      targetType: 'WorkflowDefinition',
      targetId: id,
      summary: `Rollback workflow ${before?.name ?? id} to version ${body.versionId}.`,
      payload: {
        versionId: body.versionId,
        before: before ? {
          name: before.name,
          status: before.status,
          stepCount: Array.isArray(before.steps) ? before.steps.length : 0,
        } : null,
      },
    });
    if (approval) return approval;

    const result = await rollbackWorkflowToVersion({
      workflowId: id,
      versionId: String(body.versionId),
      actorUserId: auth.ctx.userId,
    });
    if (!result) {
      return NextResponse.json({ error: 'Workflow version not found' }, { status: 404 });
    }

    const after = await getWorkflowWithSteps(id);
    await recordAdminChange({
      req,
      ctx: auth.ctx,
      tenantId: auth.workflow.tenantId,
      entityType: 'WorkflowDefinition',
      entityId: id,
      entityName: after?.name ?? before?.name,
      action: 'ROLLBACK',
      before,
      after,
      summary: `Rolled back workflow ${after?.name ?? id} to version ${result.version.versionNumber}.`,
    });

    return NextResponse.json({ ok: true, ...result, workflow: after });
  } catch (e: unknown) {
    return NextResponse.json({ error: errorMessage(e) }, { status: 500 });
  }
}
