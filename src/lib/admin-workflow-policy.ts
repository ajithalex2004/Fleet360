import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { requireAdminPermission, resolveTenantBoundary } from '@/lib/admin-policy';

export async function requireWorkflowAccess(
  req: NextRequest,
  action: 'view' | 'create' | 'edit' | 'delete' | 'publish',
  workflowId: string,
) {
  const resolvedAction = action === 'publish' ? 'edit' : action;
  const auth = await requireAdminPermission(req, resolvedAction, 'workflows');
  if (auth instanceof NextResponse) return auth;

  const rows = await prisma.$queryRawUnsafe<Array<{ id: string; tenantId: string | null }>>(
    `SELECT id, "tenantId" FROM "WorkflowDefinition" WHERE id = $1 LIMIT 1`,
    workflowId,
  ).catch(() => []);

  const workflow = rows[0];
  if (!workflow) return NextResponse.json({ error: 'Not found' }, { status: 404 });
  if (!workflow.tenantId && !auth.ctx.isSuperAdmin) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  }
  if (workflow.tenantId) {
    const scoped = resolveTenantBoundary(auth.ctx, workflow.tenantId);
    if (scoped instanceof NextResponse) return scoped;
  }

  return { ctx: auth.ctx, permissions: auth.permissions, workflow };
}
