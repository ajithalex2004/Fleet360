export const dynamic = 'force-dynamic';

import { NextRequest, NextResponse } from 'next/server';
import { getAllWorkflowInstances, getAllPendingStepInstances } from '@/lib/workflow-db';

import { requireAuthorizedTenant } from '@/lib/tenant-context';
export async function GET(req: NextRequest) {
  const authz = requireAuthorizedTenant({ headers: req.headers, nextUrl: req.nextUrl });
  if (!authz.ok) {
    return NextResponse.json({ error: authz.error }, { status: authz.status });
  }
  const { tenantId } = authz;

  try {
    const { searchParams } = new URL(req.url);
    const view = searchParams.get('view') ?? 'instances';
    const status = searchParams.get('status') ?? undefined;
    const module = searchParams.get('module') ?? undefined;

    if (view === 'pending') {
      const rows = await getAllPendingStepInstances(tenantId);
      return NextResponse.json(rows);
    }

    const rows = await getAllWorkflowInstances(tenantId, { status, module, limit: 200 });
    return NextResponse.json(rows);
  } catch (e) {
    return NextResponse.json({ error: e?.message }, { status: 500 });
  }
}
