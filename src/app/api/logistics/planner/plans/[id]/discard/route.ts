export const dynamic = 'force-dynamic';

import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { withTenantRls } from '@/lib/rls';
import { requireAuthorizedTenant } from '@/lib/tenant-context';
import { discardPlan } from '@/lib/logistics/route-optimizer-service';

export async function POST(req: NextRequest, ctx: { params: Promise<{ id: string }> }): Promise<NextResponse> {
  const authz = requireAuthorizedTenant({ headers: req.headers, nextUrl: req.nextUrl });
  if (!authz.ok) return NextResponse.json({ error: authz.error }, { status: authz.status });
  const { id } = await ctx.params;

  try {
    await withTenantRls(prisma, authz.tenantId, () => discardPlan(authz.tenantId, id));
    return NextResponse.json({ id, status: 'DISCARDED', ok: true });
  } catch (err) {
    console.error('[api/logistics/planner/plans/[id]/discard POST]', err);
    return NextResponse.json(
      { error: err instanceof Error ? err.message : 'Failed to discard route plan' },
      { status: 400 },
    );
  }
}
