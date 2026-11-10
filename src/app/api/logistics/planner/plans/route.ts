export const dynamic = 'force-dynamic';

import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { withTenantRls } from '@/lib/rls';
import { requireAuthorizedTenant } from '@/lib/tenant-context';
import { listPlans } from '@/lib/logistics/route-optimizer-service';

export async function GET(req: NextRequest): Promise<NextResponse> {
  const authz = requireAuthorizedTenant({ headers: req.headers, nextUrl: req.nextUrl });
  if (!authz.ok) return NextResponse.json({ error: authz.error }, { status: authz.status });

  const sp = req.nextUrl.searchParams;
  const status = sp.get('status') || null;
  const limit = sp.get('limit') ? Number(sp.get('limit')) : undefined;
  const days = sp.get('days') ? Number(sp.get('days')) : undefined;

  try {
    const plans = await withTenantRls(prisma, authz.tenantId, () =>
      listPlans(authz.tenantId, { status, limit, days }),
    );
    return NextResponse.json({ plans, data: plans });
  } catch (err) {
    console.error('[api/logistics/planner/plans GET]', err);
    return NextResponse.json(
      { error: err instanceof Error ? err.message : 'Failed to list route plans' },
      { status: 500 },
    );
  }
}
