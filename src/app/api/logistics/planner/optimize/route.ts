export const dynamic = 'force-dynamic';

import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { withTenantRls } from '@/lib/rls';
import { requireAuthorizedTenant, stripTenantOwnershipFields } from '@/lib/tenant-context';
import { runOptimization, type OptimizeRequest } from '@/lib/logistics/route-optimizer-service';

export async function POST(req: NextRequest): Promise<NextResponse> {
  const authz = requireAuthorizedTenant({ headers: req.headers, nextUrl: req.nextUrl });
  if (!authz.ok) return NextResponse.json({ error: authz.error }, { status: authz.status });

  let rawBody: Record<string, unknown>;
  try {
    rawBody = (await req.json()) as Record<string, unknown>;
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 });
  }

  const body = stripTenantOwnershipFields(rawBody);
  const vehicleIds = Array.isArray(body.vehicleIds) ? body.vehicleIds.map(String).filter(Boolean) : [];
  const shipmentIds = Array.isArray(body.shipmentIds) ? body.shipmentIds.map(String).filter(Boolean) : [];

  if (vehicleIds.length === 0 || shipmentIds.length === 0) {
    return NextResponse.json(
      { error: 'vehicleIds and shipmentIds arrays are required and must be non-empty' },
      { status: 400 },
    );
  }

  try {
    const response = await withTenantRls(prisma, authz.tenantId, () =>
      runOptimization({
        tenantId: authz.tenantId,
        vehicleIds,
        shipmentIds,
        createdBy: authz.userId ?? req.headers.get('x-user-id') ?? null,
        config: (body.config && typeof body.config === 'object' ? body.config : undefined) as OptimizeRequest['config'],
      }),
    );
    return NextResponse.json(response, { status: 201 });
  } catch (err) {
    console.error('[api/logistics/planner/optimize POST]', err);
    return NextResponse.json(
      { error: err instanceof Error ? err.message : 'Route optimization failed' },
      { status: 400 },
    );
  }
}
