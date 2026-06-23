import { NextRequest, NextResponse } from 'next/server';
import { getAllWorkflowInstances, getAllPendingStepInstances } from '@/lib/workflow-db';
import { requireAdminPermission } from '@/lib/admin-policy';

export async function GET(req: NextRequest) {
  try {
    const auth = await requireAdminPermission(req, 'view', 'workflows');
    if (auth instanceof NextResponse) return auth;
    if (!auth.ctx.isSuperAdmin) {
      return NextResponse.json({ error: 'Workflow instance overview requires super admin access' }, { status: 403 });
    }

    const { searchParams } = new URL(req.url);
    const view = searchParams.get('view') ?? 'instances';
    const status = searchParams.get('status') ?? undefined;
    const module = searchParams.get('module') ?? undefined;

    if (view === 'pending') {
      const rows = await getAllPendingStepInstances();
      return NextResponse.json(rows);
    }

    const rows = await getAllWorkflowInstances({ status, module, limit: 200 });
    return NextResponse.json(rows);
  } catch (e: any) {
    return NextResponse.json({ error: e?.message }, { status: 500 });
  }
}
