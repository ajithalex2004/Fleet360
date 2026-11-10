export const dynamic = 'force-dynamic';

import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { withTenantRls } from '@/lib/rls';
import { requireAuthorizedTenant } from '@/lib/tenant-context';
import { getPlan } from '@/lib/logistics/route-optimizer-service';

export async function GET(req: NextRequest, ctx: { params: Promise<{ id: string }> }): Promise<NextResponse> {
  const authz = requireAuthorizedTenant({ headers: req.headers, nextUrl: req.nextUrl });
  if (!authz.ok) return NextResponse.json({ error: authz.error }, { status: authz.status });
  const { id } = await ctx.params;

  try {
    const plan = await withTenantRls(prisma, authz.tenantId, () => getPlan(authz.tenantId, id));
    if (!plan) {
      return NextResponse.json({ error: 'Route plan not found' }, { status: 404 });
    }
    return NextResponse.json(plan);
  } catch (err) {
    console.error('[api/logistics/planner/plans/[id] GET]', err);
    return NextResponse.json(
      { error: err instanceof Error ? err.message : 'Failed to fetch route plan' },
      { status: 500 },
    );
  }
}
