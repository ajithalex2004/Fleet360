export const dynamic = 'force-dynamic';

import { NextRequest, NextResponse } from 'next/server';
import { listCarrierPortalRfqs, resolveCarrierAppDevice, submitCarrierBid } from '@/lib/logistics/domain';
import { prisma } from '@/lib/prisma';

import { requireAuthorizedTenant } from '@/lib/tenant-context';
export const runtime = 'nodejs';

async function requireDevice(req: NextRequest) {
  const token = req.headers.get('x-carrier-app-token') || req.headers.get('authorization')?.replace(/^Bearer\s+/i, '');
  if (!token) return null;
  return resolveCarrierAppDevice(token);
}

export async function GET(req: NextRequest) {
  const authz = requireAuthorizedTenant({ headers: req.headers, nextUrl: req.nextUrl });
  if (!authz.ok) {
    return NextResponse.json({ error: authz.error }, { status: authz.status });
  }
  const { tenantId } = authz;

  const device = await requireDevice(req);
  if (!device) {
    return NextResponse.json({ error: 'Invalid carrier app token' }, { status: 401 });
  }

  const sp = req.nextUrl.searchParams;
  try {
    if (sp.get('view') === 'assigned') {
      const data = await listAssignedCarrierLoads({
        tenantId: device.tenantId,
        carrierId: device.carrierId,
        search: sp.get('search') || null,
        limit: Math.min(Math.max(parseInt(sp.get('limit') ?? '100', 10) || 100, 1), 300),
      });
      return NextResponse.json({ carrierId: device.carrierId, data }, { headers: { 'Cache-Control': 'no-store' } });
    }

    const data = await listCarrierPortalRfqs({
      tenantId: device.tenantId,
      carrierId: device.carrierId,
      status: sp.get('status') || null,
      search: sp.get('search') || null,
      limit: Math.min(Math.max(parseInt(sp.get('limit') ?? '100', 10) || 100, 1), 300),
    });
    return NextResponse.json({ carrierId: device.carrierId, data }, { headers: { 'Cache-Control': 'no-store' } });
    } catch (e) {
    console.error('[carrier-portal/app/loads GET]', e);
    return NextResponse.json(
      { error: e instanceof Error ? e.message : 'failed to load carrier loads' },
      { status: 500 },
    );
  }
}

async function listAssignedCarrierLoads(args: {
  tenantId: string;
  carrierId: string;
  search?: string | null;
  limit: number;
}) {
  const rows = await prisma.$queryRawUnsafe<Array<{
    id: string;
    shipment_no: string | null;
    status: string;
    marketplace_status: string;
    cargo_owner_name: string | null;
    shipment_type: string | null;
    priority: string;
    origin_name: string | null;
    origin_address: string | null;
    destination_name: string | null;
    destination_address: string | null;
    pickup_window_from: Date | null;
    delivery_window_to: Date | null;
    requested_vehicle_type: string | null;
    total_weight_kg: string | number | null;
    carrier_cost_amount: string | number | null;
    currency: string | null;
    latest_event_type: string | null;
    latest_event_at: Date | null;
    pod_count: bigint | number | string;
  }>>(
    `SELECT so.id, so.shipment_no, so.status, so.marketplace_status,
            so.cargo_owner_name, so.shipment_type, so.priority,
            so.origin_name, so.origin_address, so.destination_name, so.destination_address,
            so.pickup_window_from, so.delivery_window_to, so.requested_vehicle_type,
            so.total_weight_kg, so.carrier_cost_amount, so.currency,
            latest.event_type AS latest_event_type,
            latest.occurred_at AS latest_event_at,
            COALESCE(pods.pod_count, 0) AS pod_count
       FROM logistics_shipment_orders so
       LEFT JOIN LATERAL (
         SELECT event_type, occurred_at
           FROM logistics_tracking_events te
          WHERE te.tenant_id = so.tenant_id
            AND te.shipment_order_id = so.id
          ORDER BY te.occurred_at DESC, te.created_at DESC
          LIMIT 1
       ) latest ON TRUE
       LEFT JOIN LATERAL (
         SELECT COUNT(*) AS pod_count
           FROM logistics_pod_events pod
          WHERE pod.tenant_id = so.tenant_id
            AND pod.shipment_order_id = so.id
       ) pods ON TRUE
      WHERE so.tenant_id = $1
        AND so.assigned_carrier_id = $2
        AND so.deleted_at IS NULL
        AND (
          $3::text IS NULL
          OR so.shipment_no ILIKE '%' || $3 || '%'
          OR so.origin_name ILIKE '%' || $3 || '%'
          OR so.destination_name ILIKE '%' || $3 || '%'
          OR so.cargo_owner_name ILIKE '%' || $3 || '%'
        )
      ORDER BY
        CASE so.status
          WHEN 'ASSIGNED' THEN 1
          WHEN 'DISPATCHED' THEN 2
          WHEN 'ENROUTE_PICKUP' THEN 3
          WHEN 'LOADED' THEN 4
          WHEN 'ENROUTE_DELIVERY' THEN 5
          WHEN 'DELIVERED' THEN 6
          ELSE 9
        END,
        so.pickup_window_from NULLS LAST,
        so.updated_at DESC
      LIMIT $4`,
    args.tenantId,
    args.carrierId,
    args.search || null,
    args.limit,
  );

  return rows.map(row => ({
    id: row.id,
    shipmentNo: row.shipment_no,
    status: row.status,
    marketplaceStatus: row.marketplace_status,
    cargoOwnerName: row.cargo_owner_name,
    shipmentType: row.shipment_type,
    priority: row.priority,
    originName: row.origin_name,
    originAddress: row.origin_address,
    destinationName: row.destination_name,
    destinationAddress: row.destination_address,
    pickupWindowFrom: row.pickup_window_from?.toISOString() ?? null,
    deliveryWindowTo: row.delivery_window_to?.toISOString() ?? null,
    requestedVehicleType: row.requested_vehicle_type,
    totalWeightKg: row.total_weight_kg == null ? null : Number(row.total_weight_kg),
    carrierCostAmount: row.carrier_cost_amount == null ? null : Number(row.carrier_cost_amount),
    currency: row.currency,
    latestEventType: row.latest_event_type,
    latestEventAt: row.latest_event_at?.toISOString() ?? null,
    podCount: Number(row.pod_count ?? 0),
  }));
}

export async function POST(req: NextRequest) {
  const authz = requireAuthorizedTenant({ headers: req.headers, nextUrl: req.nextUrl });
  if (!authz.ok) {
    return NextResponse.json({ error: authz.error }, { status: authz.status });
  }
  const { tenantId } = authz;

  const device = await requireDevice(req);
  if (!device) {
    return NextResponse.json({ error: 'Invalid carrier app token' }, { status: 401 });
  }

  let body: { rfqId?: string; shipmentOrderId?: string; amount?: number | string; currency?: string | null; transitTimeHours?: number | string | null; notes?: string | null };
  try { body = await req.json(); }
  catch { return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 }); }

  const amount = Number(body.amount);
  if (!body.rfqId || !body.shipmentOrderId || !Number.isFinite(amount) || amount <= 0) {
    return NextResponse.json({ error: 'rfqId, shipmentOrderId, and a valid amount are required' }, { status: 400 });
  }

  try {
    const bid = await submitCarrierBid({
      tenantId: device.tenantId,
      shipmentOrderId: body.shipmentOrderId,
      rfqId: body.rfqId,
      carrierId: device.carrierId,
      amount,
      currency: body.currency ?? 'AED',
      transitTimeHours: body.transitTimeHours == null || body.transitTimeHours === '' ? null : Number(body.transitTimeHours),
      notes: body.notes ?? null,
      status: 'SUBMITTED',
    });
    return NextResponse.json({ data: bid }, { status: 201 });
    } catch (e) {
    console.error('[carrier-portal/app/loads POST]', e);
    return NextResponse.json(
      { error: e instanceof Error ? e.message : 'failed to submit bid' },
      { status: 400 },
    );
  }
}
