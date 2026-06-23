/**
 * GET /api/shipper-portal/shipments/[id]
 *
 * Single-shipment view for the portal shipper. The server resolves the
 * effective tracking level for this (tenant, customer, shipment) triple,
 * then runs filterShipmentForTracking to project away anything above the
 * shipper's permitted level. Driver name, carrier identity, live GPS —
 * those only appear at FULL_TRACKING.
 *
 * Strict customer scoping: 404 if the shipment doesn't belong to the
 * caller's customer. We return 404 (not 403) so a hostile shipper can't
 * tell whether a particular shipment ID exists at all.
 */

import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { requireShipperPortal } from '@/lib/shipper-portal/auth';
import {
  resolveTrackingLevel,
  filterShipmentForTracking,
  type FullShipmentForPortal,
} from '@/lib/shipper-portal/visibility';

export const runtime = 'nodejs';

// Raw row shape mirroring the SELECT in the query below.
interface ShipmentRow {
  id: string;
  shipment_no: string | null;
  status: string;
  created_at: string;
  origin_name: string | null;
  origin_address: string | null;
  destination_name: string | null;
  destination_address: string | null;
  pickup_window_from: string | null;
  pickup_window_to: string | null;
  delivery_window_from: string | null;
  delivery_window_to: string | null;
  total_weight_kg: string | null;
  total_volume_cbm: string | null;
  customer_rate_amount: string | null;
  currency: string | null;
  assigned_carrier_id: string | null;
  assigned_driver_id: string | null;
  assigned_vehicle_id: string | null;
  // joined
  carrier_name: string | null;
  driver_name: string | null;
  driver_phone: string | null;
  vehicle_plate: string | null;
  vehicle_type: string | null;
}

interface TimelineRow {
  status: string;
  occurred_at: string;
  notes: string | null;
}

interface TrackingRow {
  latitude: number | null;
  longitude: number | null;
  occurred_at: string;
  source: string;
}

export async function GET(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const auth = await requireShipperPortal(req);
  if (auth instanceof NextResponse) return auth;

  const { id } = await params;

  // Load the shipment + joined identity bits. JOINs are LEFT so missing
  // carrier/driver/vehicle data just leaves nulls — doesn't break the row.
  let row: ShipmentRow | undefined;
  try {
    const rows = await prisma.$queryRawUnsafe<ShipmentRow[]>(
      `SELECT s.id::text, s.shipment_no, s.status, s.created_at::text,
              s.origin_name, s.origin_address,
              s.destination_name, s.destination_address,
              s.pickup_window_from::text, s.pickup_window_to::text,
              s.delivery_window_from::text, s.delivery_window_to::text,
              s.total_weight_kg::text, s.total_volume_cbm::text,
              s.customer_rate_amount::text, s.currency,
              s.assigned_carrier_id, s.assigned_driver_id, s.assigned_vehicle_id,
              c.name AS carrier_name,
              d.first_name || ' ' || COALESCE(d.last_name, '') AS driver_name,
              d.contact_number AS driver_phone,
              v.license_plate AS vehicle_plate,
              v.vehicle_class AS vehicle_type
         FROM logistics_shipment_orders s
         LEFT JOIN logistics_carriers c ON c.id::text = s.assigned_carrier_id
         LEFT JOIN drivers d ON d.id::text = s.assigned_driver_id
         LEFT JOIN vehicles v ON v.id::text = s.assigned_vehicle_id
        WHERE s.id = $1
          AND s.tenant_id = $2
          AND s.cargo_owner_customer_id = $3
          AND s.deleted_at IS NULL
        LIMIT 1`,
      id, auth.tenantId, auth.customerId,
    );
    row = rows[0];
  } catch (e) {
    console.error('[shipper-portal/shipments/[id]] shipment fetch', e);
  }
  if (!row) {
    return NextResponse.json({ error: 'Not found' }, { status: 404 });
  }

  // Timeline events (status history). Best-effort — falls back to empty array.
  let timeline: Array<{ status: string; date: string; note?: string | null }> = [];
  try {
    const t = await prisma.$queryRawUnsafe<TimelineRow[]>(
      `SELECT status, occurred_at::text, notes
         FROM logistics_tracking_events
        WHERE shipment_order_id = $1 AND tenant_id = $2
        ORDER BY occurred_at ASC`,
      row.id, auth.tenantId,
    );
    timeline = t.map(e => ({ status: e.status, date: e.occurred_at, note: e.notes }));
  } catch { /* table absent or empty */ }

  // Latest GPS — only used when level=FULL_TRACKING.
  let lastTrackingEvent: { lat: number; lng: number; capturedAt: string; source: string } | null = null;
  try {
    const t = await prisma.$queryRawUnsafe<TrackingRow[]>(
      `SELECT latitude, longitude, occurred_at::text, source
         FROM logistics_tracking_events
        WHERE shipment_order_id = $1 AND tenant_id = $2
          AND latitude IS NOT NULL AND longitude IS NOT NULL
        ORDER BY occurred_at DESC
        LIMIT 1`,
      row.id, auth.tenantId,
    );
    if (t[0] && t[0].latitude != null && t[0].longitude != null) {
      lastTrackingEvent = {
        lat: Number(t[0].latitude),
        lng: Number(t[0].longitude),
        capturedAt: t[0].occurred_at,
        source: t[0].source,
      };
    }
  } catch { /* tracking absent */ }

  // Build the full shipment shape the filter expects.
  const full: FullShipmentForPortal = {
    id: row.id,
    shipmentNo: row.shipment_no,
    status: row.status,
    submittedAt: row.created_at,
    origin: {
      name: row.origin_name,
      address: row.origin_address,
      city: null,    // origin_city not present on DB schema (Phase 2 stop-level breakdown)
      country: null,
    },
    destination: {
      name: row.destination_name,
      address: row.destination_address,
      city: null,
      country: null,
    },
    pickupWindowFrom: row.pickup_window_from,
    pickupWindowTo: row.pickup_window_to,
    deliveryWindowFrom: row.delivery_window_from,
    deliveryWindowTo: row.delivery_window_to,
    totalWeightKg: row.total_weight_kg != null ? Number(row.total_weight_kg) : null,
    totalVolumeCbm: row.total_volume_cbm != null ? Number(row.total_volume_cbm) : null,
    customerRateAmount: row.customer_rate_amount != null ? Number(row.customer_rate_amount) : null,
    currency: row.currency,
    timeline,
    estimatedDeliveryAt: row.delivery_window_to, // best-effort until ML ETA lands
    plannedRoute: [], // empty until route polyline is computed
    lastTrackingEvent,
    assignedCarrierName: row.carrier_name,
    assignedDriverName: row.driver_name?.trim() || null,
    assignedDriverPhone: row.driver_phone,
    assignedVehiclePlate: row.vehicle_plate,
    assignedVehicleType: row.vehicle_type,
  };

  // Resolve the effective tracking level for this shipper × shipment.
  const level = await resolveTrackingLevel(auth.tenantId, auth.customerId, row.id);

  // Filter the payload — anything beyond the permitted level gets stripped.
  const filtered = filterShipmentForTracking(full, level);

  return NextResponse.json(filtered, {
    // Short cache because the live location updates as the truck moves.
    headers: { 'Cache-Control': 'private, max-age=10, stale-while-revalidate=20' },
  });
}
