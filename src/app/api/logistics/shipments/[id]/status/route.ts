import { NextRequest, NextResponse } from 'next/server';
import { updateShipmentOrder } from '@/lib/logistics/domain';
import { getEventBus }      from '@/events/event-bus';
import { SHIPMENT_CLOSED }  from '@/events/registry';

export const runtime = 'nodejs';

const VALID_TRANSITIONS: Record<string, string[]> = {
  DRAFT: ['PENDING', 'CANCELLED'],
  PENDING: ['APPROVED', 'CANCELLED'],
  APPROVED: ['ASSIGNED', 'DISPATCHED', 'CANCELLED'],
  ASSIGNED: ['DISPATCHED', 'CANCELLED'],
  DISPATCHED: ['ENROUTE_PICKUP', 'CANCELLED'],
  ENROUTE_PICKUP: ['LOADED'],
  LOADED: ['ENROUTE_DELIVERY'],
  ENROUTE_DELIVERY: ['DELIVERED'],
  DELIVERED: ['POD_SUBMITTED'],
  POD_SUBMITTED: ['CLOSED'],
  CLOSED: [],
  CANCELLED: [],
};

function normalizeTransitionStatus(status: string): string {
  switch (status.trim().toUpperCase()) {
    case 'CONFIRMED':
      return 'APPROVED';
    case 'ACTIVE':
      return 'ENROUTE_DELIVERY';
    case 'COMPLETED':
      return 'CLOSED';
    default:
      return status.trim().toUpperCase();
  }
}

export async function PATCH(req: NextRequest, { params }: { params: { id: string } }) {
  const tenantId = req.headers.get('x-tenant-id');
  if (!tenantId) {
    return NextResponse.json({ error: 'Not authenticated' }, { status: 401 });
  }

  let body: { currentStatus?: string | null; status?: string; note?: string | null };
  try { body = await req.json(); }
  catch { return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 }); }

  const next = normalizeTransitionStatus(String(body.status ?? ''));
  if (!next) return NextResponse.json({ error: 'status is required' }, { status: 400 });

  const current = normalizeTransitionStatus(String(body.currentStatus ?? ''));
  if (current && !VALID_TRANSITIONS[current]?.includes(next)) {
    return NextResponse.json({ error: `Cannot transition from ${current} to ${next}` }, { status: 422 });
  }

  try {
    const shipment = await updateShipmentOrder({
      tenantId,
      shipmentOrderId: params.id,
      status: next,
      updatedBy: req.headers.get('x-user-id') ?? null,
      metadata: {
        lastStatusNote: body.note ?? null,
        lastStatusChangedAt: new Date().toISOString(),
      },
    });

    // Enqueue finance mirroring via transactional outbox when shipment closes.
    if (next === 'CLOSED') {
      await getEventBus().publish({
        eventType:     SHIPMENT_CLOSED,
        aggregateType: 'ShipmentOrder',
        aggregateId:   params.id,
        sourceModule:  'logistics',
        tenantId,
        actor:         req.headers.get('x-user-id') ?? 'system',
        payload: {
          shipmentOrderId: params.id,
          shipmentNo:      (shipment as any).shipmentNo ?? null,
          currency:        (shipment as any).currency   ?? 'AED',
          closedAt:        new Date().toISOString(),
        },
      }).catch(err => console.error('[logistics] outbox publish failed:', err));
    }

    return NextResponse.json({ success: true, data: shipment });
  } catch (e) {
    console.error('[logistics/shipments/:id/status PATCH]', e);
    return NextResponse.json(
      { error: e instanceof Error ? e.message : 'failed to update shipment status' },
      { status: 500 },
    );
  }
}
