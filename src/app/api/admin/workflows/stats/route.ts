import { NextRequest, NextResponse } from 'next/server';
import { getWorkflowStats } from '@/lib/workflow-db';
import { requireAdminPermission } from '@/lib/admin-policy';

export async function GET(req: NextRequest) {
  try {
    const auth = await requireAdminPermission(req, 'view', 'workflows');
    if (auth instanceof NextResponse) return auth;
    if (!auth.ctx.isSuperAdmin) {
      return NextResponse.json({ error: 'Workflow platform stats require super admin access' }, { status: 403 });
    }
    const stats = await getWorkflowStats();
    return NextResponse.json(stats);
  } catch (e: any) {
    return NextResponse.json({ total: 0, active: 0, pendingApprovals: 0, activeInstances: 0 });
  }
}
