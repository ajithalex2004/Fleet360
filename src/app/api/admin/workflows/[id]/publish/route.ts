import { NextRequest, NextResponse } from 'next/server';
import { getWorkflowWithSteps, publishWorkflow } from '@/lib/workflow-db';
import { recordAdminChange } from '@/lib/admin-change-history';
import { requireWorkflowAccess } from '@/lib/admin-workflow-policy';

function errorMessage(error: unknown) {
  return error instanceof Error ? error.message : String(error);
}

export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await params;
    const auth = await requireWorkflowAccess(req, 'publish', id);
    if (auth instanceof NextResponse) return auth;

    const before = await getWorkflowWithSteps(id);
    const body = await req.json().catch(() => ({}));
    const version = await publishWorkflow(id, auth.ctx.userId, body?.changeSummary ? String(body.changeSummary) : null);
    const after = await getWorkflowWithSteps(id);

    await recordAdminChange({
      req,
      ctx: auth.ctx,
      tenantId: auth.workflow.tenantId,
      entityType: 'WorkflowDefinition',
      entityId: id,
      entityName: after?.name ?? before?.name,
      action: 'PUBLISH',
      before,
      after: {
        ...after,
        publishedVersionId: version.id,
        publishedVersionNumber: version.versionNumber,
      },
      summary: `Published workflow ${after?.name ?? id} as version ${version.versionNumber}.`,
    });

    return NextResponse.json({
      success: true,
      versionId: version.id,
      versionNumber: version.versionNumber,
      status: version.status,
    });
  } catch (e: unknown) {
    return NextResponse.json({ error: errorMessage(e) }, { status: 500 });
  }
}
