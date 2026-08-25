import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { withTenantRls } from '@/lib/rls';

import { requireAuthorizedTenant } from '@/lib/tenant-context';
const STATUS_LABEL: Record<string, string> = {
  DRAFT: 'Shipment Drafted',
  PENDING: 'Shipment Created',
  APPROVED: 'Shipment Approved',
  ASSIGNED: 'Carrier Assigned',
  DISPATCHED: 'Shipment Dispatched',
  ENROUTE_PICKUP: 'En-route to Pickup',
  LOADED: 'Cargo Loaded',
  ENROUTE_DELIVERY: 'Out for Delivery',
  DELIVERED: 'Delivered',
  POD_SUBMITTED: 'Delivery Confirmed',
  CLOSED: 'Closed',
  CANCELLED: 'Cancelled',
};

const STATUS_ORDER = [
  'PENDING',
  'APPROVED',
  'ASSIGNED',
  'DISPATCHED',
  'ENROUTE_PICKUP',
  'LOADED',
  'ENROUTE_DELIVERY',
  'DELIVERED',
  'POD_SUBMITTED',
  'CLOSED',
];

const LEGACY_STATUS: Record<string, string> = {
  CONFIRMED: 'APPROVED',
  ACTIVE: 'ENROUTE_DELIVERY',
  COMPLETED: 'CLOSED',
};

export async function GET(_req: NextRequest, props: { params: Promise<{ ref: string }> }) {
  const params = await props.params;
  const authz = requireAuthorizedTenant({ headers: _req.headers, nextUrl: _req.nextUrl });
  if (!authz.ok) {
    return NextResponse.json({ error: authz.error }, { status: authz.status });
  }
  const { tenantId } = authz;

  const ref = (params.ref ?? '').toUpperCase().trim();
  if (!ref) return NextResponse.json({ error: 'Missing reference' }, { status: 400 });

  try {
    // Scoped with withTenantRls: logistics_shipment_orders,
    // logistics_tracking_events and logistics_pod_events are all
    // RLS-protected. Despite the "public tracking" framing in the docblock
    // above, this route requires an authorised tenant, so scoping to it is
    // consistent — a caller can only track their own tenant's shipments.
    // Unscoped, the lookup finds nothing and this returns
    // "Tracking reference not found" for every reference.
    return await withTenantRls(prisma, tenantId, async (tx) => {
    const shipment = await findShipmentByPublicRef(tx, ref);
    if (!shipment) {
      return NextResponse.json({ error: 'Tracking reference not found.' }, { status: 404 });
    }

    const status = LEGACY_STATUS[shipment.status] ?? shipment.status ?? 'PENDING';
    const currentIdx = STATUS_ORDER.indexOf(status);
    const [events, podRows] = await Promise.all([
      tx.$queryRawUnsafe<Array<{
        event_type: string;
        status: string | null;
        occurred_at: Date;
        notes: string | null;
      }>>(
        `SELECT event_type, status, occurred_at, notes
           FROM logistics_tracking_events
          WHERE tenant_id = $1
            AND shipment_order_id = $2
          ORDER BY occurred_at ASC, created_at ASC`,
        shipment.tenant_id,
        shipment.id,
      ).catch(() => []),
      tx.$queryRawUnsafe<Array<{
        delivered_at: Date | null;
        recipient_name: string | null;
        gps: unknown;
        metadata: Record<string, unknown> | null;
      }>>(
        `SELECT delivered_at, recipient_name, gps, metadata
           FROM logistics_pod_events
          WHERE tenant_id = $1
            AND shipment_order_id = $2
          ORDER BY created_at DESC
          LIMIT 1`,
        shipment.tenant_id,
        shipment.id,
      ).catch(() => []),
    ]);

    const historyMap: Record<string, { ts: Date; note: string | null }> = {};
    for (const event of events) {
      const eventStatus = event.status ? (LEGACY_STATUS[event.status] ?? event.status) : statusFromEvent(event.event_type);
      if (!eventStatus) continue;
      historyMap[eventStatus] = {
        ts: event.occurred_at instanceof Date ? event.occurred_at : new Date(event.occurred_at),
        note: event.notes,
      };
    }
    if (shipment.created_at && !historyMap.PENDING) {
      historyMap.PENDING = {
        ts: shipment.created_at instanceof Date ? shipment.created_at : new Date(shipment.created_at),
        note: null,
      };
    }

    const timeline = STATUS_ORDER.map((step, idx) => {
      const hist = historyMap[step];
      const isCurrent = step === status || (currentIdx === -1 && idx === 0);
      return {
        status: step,
        label: STATUS_LABEL[step] ?? step,
        timestamp: hist ? hist.ts.toISOString() : null,
        completed: idx < currentIdx || Boolean(hist) || step === status,
        isCurrent,
        note: hist?.note ?? null,
      };
    });

    const pod = podRows[0] ?? null;
    const progress = status === 'CANCELLED' ? 0
      : status === 'CLOSED' ? 100
      : currentIdx === -1 ? 10
        : Math.round(((currentIdx + 1) / STATUS_ORDER.length) * 100);

    return NextResponse.json({
      bookingRef: shipment.shipment_no,
      shipmentNo: shipment.shipment_no,
      status,
      statusLabel: STATUS_LABEL[status] ?? status,
      progress,
      isCancelled: status === 'CANCELLED',
      isDelivered: ['DELIVERED', 'POD_SUBMITTED', 'CLOSED'].includes(status),
      customerName: shipment.cargo_owner_name,
      origin: shipment.origin_name ?? shipment.origin_address,
      destination: shipment.destination_name ?? shipment.destination_address,
      shipmentType: shipment.shipment_type,
      driverName: null,
      vehiclePlate: null,
      weightKg: shipment.total_weight_kg == null ? null : Number(shipment.total_weight_kg),
      cargo: shipment.notes,
      scheduledDate: shipment.pickup_window_from ? shipment.pickup_window_from.toISOString() : null,
      estimatedDelivery: shipment.delivery_window_to ? shipment.delivery_window_to.toISOString() : null,
      createdAt: shipment.created_at ? shipment.created_at.toISOString() : null,
      timeline,
      pod: pod ? {
        deliveredAt: pod.delivered_at ? pod.delivered_at.toISOString() : null,
        recipientName: pod.recipient_name,
        note: typeof pod.metadata?.deliveryNote === 'string' ? pod.metadata.deliveryNote : null,
        hasSignature: true,
        gps: pod.gps,
      } : null,
    });
    });
    } catch (err) {
    console.error('[track GET]', err);
    return NextResponse.json({ error: 'Unable to retrieve tracking information.' }, { status: 500 });
  }
}

async function findShipmentByPublicRef(
  client: { $queryRawUnsafe: <T>(sql: string, ...a: unknown[]) => Promise<T> },
  ref: string,
) {
  const rows = await client.$queryRawUnsafe<Array<{
    id: string;
    tenant_id: string;
    shipment_no: string;
    status: string;
    cargo_owner_name: string | null;
    shipment_type: string | null;
    origin_name: string | null;
    origin_address: string | null;
    destination_name: string | null;
    destination_address: string | null;
    pickup_window_from: Date | null;
    delivery_window_to: Date | null;
    total_weight_kg: string | number | null;
    notes: string | null;
    created_at: Date;
  }>>(
    `SELECT so.id, so.tenant_id, so.shipment_no, so.status, so.cargo_owner_name,
            so.shipment_type, so.origin_name, so.origin_address,
            so.destination_name, so.destination_address, so.pickup_window_from,
            so.delivery_window_to, so.total_weight_kg, so.notes, so.created_at
       FROM logistics_shipment_orders so
       LEFT JOIN bookings b ON b.id = so.legacy_booking_id
      WHERE so.deleted_at IS NULL
        AND (
          UPPER(so.shipment_no) = $1
          OR UPPER(COALESCE(b.booking_ref, '')) = $1
        )
      LIMIT 1`,
    ref,
  ).catch(() => []);

  return rows[0] ?? null;
}

function statusFromEvent(eventType: string) {
  const key = String(eventType ?? '').toUpperCase();
  if (key === 'SHIPMENT_ASSIGNED') return 'ASSIGNED';
  if (key === 'PICKUP_CONFIRMED') return 'LOADED';
  if (key === 'DELIVERY_CONFIRMED') return 'DELIVERED';
  if (key === 'LOAD_BROADCAST_ASSIGNED') return 'ASSIGNED';
  return null;
}
