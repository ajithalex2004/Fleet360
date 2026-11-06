export const dynamic = 'force-dynamic';

import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { withTenantRls } from '@/lib/rls';
import { updateShipmentOrder } from '@/lib/logistics/domain';
import { getEventBus } from '@/events/event-bus';
import { SHIPMENT_CLOSED } from '@/events/registry';
import { notifyShipmentStatus } from '@/lib/logistics/customer-notifications';
import { requireAuthorizedTenant, stripTenantOwnershipFields } from '@/lib/tenant-context';

export const runtime = 'nodejs';

const VALID_TRANSITIONS: Record<string, string[]> = {
  DRAFT: ['SUBMITTED', 'PENDING', 'APPROVED', 'CANCELLED'],
  SUBMITTED: ['PENDING', 'APPROVED', 'ASSIGNED', 'CANCELLED'],
  PENDING: ['APPROVED', 'ASSIGNED', 'CANCELLED'],
  APPROVED: ['ASSIGNED', 'DISPATCHED', 'CANCELLED'],
  ASSIGNED: ['DISPATCHED', 'ENROUTE_PICKUP', 'IN_TRANSIT', 'CANCELLED'],
  DISPATCHED: ['ENROUTE_PICKUP', 'LOADED', 'IN_TRANSIT', 'CANCELLED'],
  ENROUTE_PICKUP: ['LOADED', 'IN_TRANSIT', 'CANCELLED'],
  LOADED: ['IN_TRANSIT', 'ENROUTE_DELIVERY'],
  IN_TRANSIT: ['LOADED', 'ENROUTE_DELIVERY', 'DELIVERED', 'CANCELLED'],
  ENROUTE_DELIVERY: ['DELIVERED'],
  DELIVERED: ['POD_SUBMITTED', 'CLOSED'],
  POD_SUBMITTED: ['CLOSED'],
  CLOSED: [],
  CANCELLED: [],
};

const LEGACY_STATUS_MAP: Record<string, string> = {
  CONFIRMED: 'APPROVED',
  ACTIVE: 'ENROUTE_DELIVERY',
  COMPLETED: 'CLOSED',
};

function normalizeTransitionStatus(status: string): string {
  const upper = status.trim().toUpperCase();
  return LEGACY_STATUS_MAP[upper] ?? upper;
}

export async function PATCH(req: NextRequest, props: { params: Promise<{ id: string }> }) {
  const params = await props.params;
  const authz = requireAuthorizedTenant({ headers: req.headers, nextUrl: req.nextUrl });
  if (!authz.ok) {
    return NextResponse.json({ error: authz.error }, { status: authz.status });
  }

  const { tenantId } = authz;

  let rawBody: { currentStatus?: string | null; status?: string; note?: string | null };
  try {
    rawBody = await req.json();
  } catch {
    return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 });
  }
  const body = stripTenantOwnershipFields(rawBody);

  const next = normalizeTransitionStatus(String(body.status ?? ''));
  if (!next) return NextResponse.json({ error: 'status is required' }, { status: 400 });

  try {
    const executeTransition = async (client: { $queryRawUnsafe: typeof prisma.$queryRawUnsafe }) => {
      const rows = await client.$queryRawUnsafe<Array<{
        status?: string | null;
        shipment_no?: string | null;
        currency?: string | null;
      }>>(
        `SELECT status, shipment_no, currency
           FROM logistics_shipment_orders
          WHERE id = $1 AND tenant_id = $2 AND deleted_at IS NULL
          LIMIT 1`,
        params.id,
        tenantId,
      ).catch(() => []);

      const existing = rows[0] ?? null;
      const current = normalizeTransitionStatus(String(existing?.status || body.currentStatus || ''));
      if (current && current !== next && !VALID_TRANSITIONS[current]?.includes(next)) {
        return NextResponse.json(
          { error: `Cannot transition from ${current} to ${next}` },
          { status: 422 },
        );
      }

      const shipment = await updateShipmentOrder({
        tenantId,
        shipmentOrderId: params.id,
        status: next,
        updatedBy: authz.userId ?? req.headers.get('x-user-id') ?? null,
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
          actor:         authz.userId ?? req.headers.get('x-user-id') ?? 'system',
          payload: {
            shipmentOrderId: params.id,
            shipmentNo:      (shipment as { shipmentNo?: string | null })?.shipmentNo ?? existing?.shipment_no ?? null,
            currency:        (shipment as { currency?: string | null })?.currency ?? existing?.currency ?? 'AED',
            closedAt:        new Date().toISOString(),
          },
        }).catch(err => console.error('[logistics] outbox publish failed:', err));
      }

      // Tell the customer at the milestones they care about (best-effort).
      if (next !== current) {
        void notifyShipmentStatus({ tenantId, shipmentOrderId: params.id, status: next, reason: body.note ?? null });
      }

      return NextResponse.json({ success: true, data: shipment });
    };

    const rlsResponse = await withTenantRls(prisma, tenantId, async (tx) => executeTransition(tx));
    return rlsResponse ?? (await executeTransition(prisma));
  } catch (e) {
    console.error('[logistics/shipments/:id/status PATCH]', e);
    return NextResponse.json(
      { error: e instanceof Error ? e.message : 'failed to update shipment status' },
      { status: 400 },
    );
  }
}
