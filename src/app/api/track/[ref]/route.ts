export const dynamic = 'force-dynamic';

import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { withPlatformAdmin, withTenantRls } from '@/lib/rls';

import { requireAuthorizedTenant } from '@/lib/tenant-context';
const STATUS_LABEL: Record<string, string> = {
  DRAFT: 'Shipment Drafted',
  PENDING: 'Shipment Created',
  SUBMITTED: 'Shipment Submitted',
  APPROVED: 'Shipment Approved',
  ASSIGNED: 'Carrier Assigned',
  DISPATCHED: 'Shipment Dispatched',
  ENROUTE_PICKUP: 'En-route to Pickup',
  LOADED: 'Cargo Loaded',
  IN_TRANSIT: 'In Transit',
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
  SUBMITTED: 'PENDING',
  IN_TRANSIT: 'ENROUTE_DELIVERY',
  ACTIVE: 'ENROUTE_DELIVERY',
  COMPLETED: 'CLOSED',
};

export async function GET(_req: NextRequest, props: { params: Promise<{ ref: string }> }) {
  const params = await props.params;
  const ref = (params.ref ?? '').toUpperCase().trim();
  if (!ref) return NextResponse.json({ error: 'Missing reference' }, { status: 400 });

  const authz = requireAuthorizedTenant({ headers: _req.headers, nextUrl: _req.nextUrl });

  try {
    let tenantId = authz.ok ? authz.tenantId : '';
    if (!tenantId) {
      // External customer tracking link (/track/[ref]): resolve tenant_id by exact reference match
      const resolved = await withPlatformAdmin(prisma, async (tx) => {
        const rows = await tx.$queryRawUnsafe<Array<{ tenant_id: string }>>(
          `SELECT so.tenant_id
             FROM logistics_shipment_orders so
             LEFT JOIN bookings b ON b.id = so.legacy_booking_id
            WHERE so.deleted_at IS NULL
              AND (
                UPPER(so.shipment_no) = $1
                OR UPPER(COALESCE(b.booking_ref, '')) = $1
              )
            ORDER BY so.created_at DESC
            LIMIT 1`,
          ref,
        );
        return rows[0]?.tenant_id ?? '';
      });
      if (!resolved) {
        return NextResponse.json({ error: 'Tracking reference not found.' }, { status: 404 });
      }
      tenantId = resolved;
    }

    return await withTenantRls(prisma, tenantId, async (tx) => {
      const shipment = await findShipmentByPublicRef(tx, ref, tenantId);
      if (!shipment) {
        return NextResponse.json({ error: 'Tracking reference not found.' }, { status: 404 });
      }

      const rawStatus = shipment.status ?? 'PENDING';
      const status = LEGACY_STATUS[rawStatus] ?? rawStatus;
      const currentIdx = STATUS_ORDER.indexOf(status);

      // Run sequentially on the pinned transaction connection `tx`
      const events = await tx.$queryRawUnsafe<Array<{
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
      );

      const podRows = await tx.$queryRawUnsafe<Array<{
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
      );

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
        status: rawStatus,
        statusLabel: STATUS_LABEL[rawStatus] ?? STATUS_LABEL[status] ?? rawStatus,
        progress,
        isCancelled: status === 'CANCELLED',
        isDelivered: ['DELIVERED', 'POD_SUBMITTED', 'CLOSED'].includes(status),
        customerName: shipment.cargo_owner_name,
        origin: shipment.origin_name ?? shipment.origin_address,
        destination: shipment.destination_name ?? shipment.destination_address,
        shipmentType: shipment.shipment_type,
        driverName: shipment.driver_name ?? null,
        vehiclePlate: shipment.vehicle_plate ?? null,
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
  tenantId: string,
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
    driver_name: string | null;
    vehicle_plate: string | null;
  }>>(
    `SELECT so.id, so.tenant_id, so.shipment_no, so.status, so.cargo_owner_name,
            so.shipment_type, so.origin_name, so.origin_address,
            so.destination_name, so.destination_address, so.pickup_window_from,
            so.delivery_window_to, so.total_weight_kg, so.notes, so.created_at,
            NULLIF(TRIM(CONCAT(COALESCE(d.first_name, ''), ' ', COALESCE(d.last_name, ''))), '') AS driver_name,
            v.plate_number AS vehicle_plate
       FROM logistics_shipment_orders so
       LEFT JOIN bookings b ON b.id = so.legacy_booking_id
       LEFT JOIN drivers d ON d.id = so.assigned_driver_id AND d.tenant_id = so.tenant_id
       LEFT JOIN vehicles v ON v.id = so.assigned_vehicle_id AND v.tenant_id = so.tenant_id
      WHERE so.deleted_at IS NULL
        AND so.tenant_id = $2
        AND (
          UPPER(so.shipment_no) = $1
          OR UPPER(COALESCE(b.booking_ref, '')) = $1
        )
      LIMIT 1`,
    ref,
    tenantId,
  );

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
