export const dynamic = 'force-dynamic';

import { NextRequest, NextResponse } from 'next/server';
import { withTenantRls } from '@/lib/rls';
import { getWorkflowStats } from '@/lib/workflow-db';
import { isSuperAdmin } from '@/lib/admin-access';
import { withWorkflowCaller } from '@/lib/admin-scope';

import { requireAuthorizedTenant, stripTenantOwnershipFields } from '@/lib/tenant-context';
export async function GET(req: NextRequest) {
  const authz = requireAuthorizedTenant({ headers: req.headers, nextUrl: req.nextUrl });
  if (!authz.ok) {
    return NextResponse.json({ error: authz.error }, { status: authz.status });
  }
  const { tenantId } = authz;

  try {
    // A tenant's own counts; every tenant's for platform admins.
    const stats = await withWorkflowCaller(req.headers, () =>
      getWorkflowStats(isSuperAdmin(req.headers) ? null : tenantId));
    return NextResponse.json(stats);
  } catch (e: any) {
    return NextResponse.json({ total: 0, active: 0, pendingApprovals: 0, activeInstances: 0 });
  }
}
