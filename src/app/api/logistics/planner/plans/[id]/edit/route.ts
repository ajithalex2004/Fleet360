export const dynamic = 'force-dynamic';

import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { withTenantRls } from '@/lib/rls';
import { requireAuthorizedTenant, stripTenantOwnershipFields } from '@/lib/tenant-context';
import { revalidatePlan } from '@/lib/logistics/route-optimizer-service';

export async function POST(req: NextRequest, ctx: { params: Promise<{ id: string }> }): Promise<NextResponse> {
  const authz = requireAuthorizedTenant({ headers: req.headers, nextUrl: req.nextUrl });
  if (!authz.ok) return NextResponse.json({ error: authz.error }, { status: authz.status });
  const { id } = await ctx.params;

  let rawBody: Record<string, unknown>;
  try {
    rawBody = (await req.json()) as Record<string, unknown>;
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 });
  }

  const body = stripTenantOwnershipFields(rawBody);
  const editedRoutes = Array.isArray(body.editedRoutes)
    ? (body.editedRoutes as Array<{ vehicleId: string; stopOrder: string[] }>)
    : [];
  const unassign = Array.isArray(body.unassign) ? body.unassign.map(String) : undefined;

  try {
    const updated = await withTenantRls(prisma, authz.tenantId, () =>
      revalidatePlan({
        tenantId: authz.tenantId,
        planId: id,
        editedRoutes,
        unassign,
      }),
    );
    return NextResponse.json(updated);
  } catch (err) {
    console.error('[api/logistics/planner/plans/[id]/edit POST]', err);
    const message = err instanceof Error ? err.message : 'Failed to revalidate route plan';
    const status = /not found/i.test(message) ? 404 : /Only DRAFT/i.test(message) ? 409 : 400;
    return NextResponse.json({ error: message }, { status });
  }
}
