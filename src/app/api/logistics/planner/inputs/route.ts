export const dynamic = 'force-dynamic';

import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { withTenantRls } from '@/lib/rls';
import { requireAuthorizedTenant } from '@/lib/tenant-context';
import { listPlannerInputs } from '@/lib/logistics/route-optimizer-service';

export async function GET(req: NextRequest): Promise<NextResponse> {
  const authz = requireAuthorizedTenant({ headers: req.headers, nextUrl: req.nextUrl });
  if (!authz.ok) return NextResponse.json({ error: authz.error }, { status: authz.status });

  try {
    const data = await withTenantRls(prisma, authz.tenantId, () => listPlannerInputs(authz.tenantId));
    return NextResponse.json({
      inputs: data.shipments,
      vehicles: data.vehicles,
      shipments: data.shipments,
    });
  } catch (err) {
    console.error('[api/logistics/planner/inputs GET]', err);
    return NextResponse.json(
      { error: err instanceof Error ? err.message : 'Failed to load planner inputs' },
      { status: 500 },
    );
  }
}
