export const dynamic = 'force-dynamic';

import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { withTenantRls } from '@/lib/rls';
import { requireAuthorizedTenant } from '@/lib/tenant-context';
import { commitPlan } from '@/lib/logistics/route-optimizer-service';

export async function POST(req: NextRequest, ctx: { params: Promise<{ id: string }> }): Promise<NextResponse> {
  const authz = requireAuthorizedTenant({ headers: req.headers, nextUrl: req.nextUrl });
  if (!authz.ok) return NextResponse.json({ error: authz.error }, { status: authz.status });
  const { id } = await ctx.params;
  const actorUserId = authz.userId ?? req.headers.get('x-user-id') ?? 'operator';

  try {
    const result = await withTenantRls(prisma, authz.tenantId, () =>
      commitPlan(authz.tenantId, id, actorUserId),
    );
    return NextResponse.json({ id, status: 'COMMITTED', ...result });
  } catch (err) {
    console.error('[api/logistics/planner/plans/[id]/commit POST]', err);
    const message = err instanceof Error ? err.message : 'Failed to commit route plan';
    const status = /not found/i.test(message) ? 404 : /discarded/i.test(message) ? 409 : 400;
    return NextResponse.json({ error: message }, { status });
  }
}
