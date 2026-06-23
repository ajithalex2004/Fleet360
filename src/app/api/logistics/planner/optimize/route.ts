/**
 * POST /api/logistics/planner/optimize
 *
 * Run the VRP solver for the selected vehicles + shipments and persist the
 * result as a DRAFT plan. Returns the full RouteOptimizerResult so the
 * planner UI can render routes immediately.
 *
 * Body: { vehicleIds: string[], shipmentIds: string[], config?: {...} }
 * Auth: tenant operator session.
 */

import { NextRequest, NextResponse } from 'next/server';
import { runOptimization, type OptimizeRequest } from '@/lib/logistics/route-optimizer-service';

export const runtime = 'nodejs';

export async function POST(req: NextRequest) {
  const tenantId = req.headers.get('x-tenant-id');
  const userId = req.headers.get('x-user-id');
  if (!tenantId) {
    return NextResponse.json({ error: 'Not authenticated' }, { status: 401 });
  }

  let body: Partial<OptimizeRequest>;
  try { body = (await req.json()) as Partial<OptimizeRequest>; }
  catch { return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 }); }

  if (!body.vehicleIds?.length) {
    return NextResponse.json({ error: 'At least one vehicle is required' }, { status: 400 });
  }
  if (!body.shipmentIds?.length) {
    return NextResponse.json({ error: 'At least one shipment is required' }, { status: 400 });
  }

  try {
    const result = await runOptimization({
      tenantId,
      vehicleIds: body.vehicleIds,
      shipmentIds: body.shipmentIds,
      createdBy: userId ?? null,
      config: body.config,
    });
    return NextResponse.json(result, { status: 200 });
  } catch (e) {
    console.error('[planner/optimize]', e);
    return NextResponse.json(
      { error: e instanceof Error ? e.message : 'optimization failed' },
      { status: 500 },
    );
  }
}
