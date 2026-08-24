import { NextRequest, NextResponse } from 'next/server';
import { createShipmentAssignment } from '@/lib/logistics/domain';

import { requireAuthorizedTenant } from '@/lib/tenant-context';
export const runtime = 'nodejs';

interface AssignBody {
  carrierId?: string | null;
  driverId?: string | null;
  vehicleId?: string | null;
  costAmount?: number | string | null;
  currency?: string | null;
  note?: string | null;
}

export async function POST(req: NextRequest, { params }: { params: { id: string } }) {
  const authz = requireAuthorizedTenant({ headers: req.headers, nextUrl: req.nextUrl });

  if (!authz.ok) {

    return NextResponse.json({ error: authz.error }, { status: authz.status });

  }

  const { tenantId } = authz;, { status: 401 });
  }

  let body: AssignBody;
  try { body = (await req.json()) as AssignBody; }
  catch { return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 }); }

  if (!body.carrierId && !body.driverId && !body.vehicleId) {
    return NextResponse.json({ error: 'Select a carrier, driver, or vehicle to assign' }, { status: 400 });
  }

  try {
    const data = await createShipmentAssignment({
      tenantId,
      shipmentOrderId: params.id,
      carrierId: body.carrierId ?? null,
      driverId: body.driverId ?? null,
      vehicleId: body.vehicleId ?? null,
      assignmentType: body.carrierId ? 'CARRIER' : 'INTERNAL_FLEET',
      status: 'ASSIGNED',
      costAmount: num(body.costAmount),
      currency: body.currency ?? 'AED',
      metadata: {
        assignedBy: req.headers.get('x-user-id') ?? null,
        note: body.note ?? null,
      },
    });
    return NextResponse.json({ data }, { status: 201 });
  } catch (e) {
    const err = e as Error & { blockers?: unknown };
    if (Array.isArray(err.blockers)) {
      return NextResponse.json({ error: err.message, blockers: err.blockers }, { status: 409 });
    }
    console.error('[logistics/shipments/:id/assign POST]', e);
    return NextResponse.json(
      { error: e instanceof Error ? e.message : 'failed to assign shipment' },
      { status: 500 },
    );
  }
}

function num(v: unknown): number | null {
  if (v === null || v === undefined || v === '') return null;
  const n = typeof v === 'number' ? v : Number(v);
  return Number.isFinite(n) ? n : null;
}
