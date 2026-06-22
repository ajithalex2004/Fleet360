/**
 * POST /api/logistics/planner/plans/[id]/edit
 *
 * Manual override after optimisation: the operator dragged a shipment to a
 * different route or reordered stops within a route. The server re-validates
 * (pickup-before-delivery, carried-forward time-window flags) but does NOT
 * re-optimise — the operator's sequence is authoritative.
 *
 * Body:
 *   {
 *     routes: Array<{ vehicleId: string; stopOrder: string[] }>,
 *     unassign?: string[]   // shipmentIds to drop from any route
 *   }
 *
 * Auth: tenant operator session.
 */

import { NextRequest, NextResponse } from 'next/server';
import { revalidatePlan } from '@/lib/logistics/route-optimizer-service';

export const runtime = 'nodejs';

interface EditBody {
  routes?: Array<{ vehicleId: string; stopOrder: string[] }>;
  unassign?: string[];
}

export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const tenantId = req.headers.get('x-tenant-id');
  if (!tenantId) {
    return NextResponse.json({ error: 'Not authenticated' }, { status: 401 });
  }

  const { id } = await params;
  let body: EditBody;
  try { body = (await req.json()) as EditBody; }
  catch { return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 }); }

  if (!Array.isArray(body.routes)) {
    return NextResponse.json({ error: 'routes array is required' }, { status: 400 });
  }

  try {
    const result = await revalidatePlan({
      tenantId,
      planId: id,
      editedRoutes: body.routes,
      unassign: body.unassign,
    });
    return NextResponse.json(result, { status: 200 });
  } catch (e) {
    console.error('[planner/plans/[id]/edit]', e);
    const msg = e instanceof Error ? e.message : 'edit failed';
    const status = /not found/i.test(msg) ? 404 : /DRAFT/i.test(msg) ? 409 : 500;
    return NextResponse.json({ error: msg }, { status });
  }
}
