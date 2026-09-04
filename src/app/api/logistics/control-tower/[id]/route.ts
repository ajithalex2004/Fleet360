export const dynamic = 'force-dynamic';

/**
 * GET /api/logistics/control-tower/[id]
 *
 * Drill-in detail for the control-tower slide-over: the shipment header, its
 * stops (the "shipment progress" timeline), tracking events (Status + Comments
 * tabs), and POD events/documents (Documents tab). Operator-scoped.
 *
 * Auth: tenant operator session; tenantId from the x-tenant-id header.
 */

import { NextRequest, NextResponse } from 'next/server';
import { withTenantRls } from '@/lib/rls';
import { prisma } from '@/lib/prisma';

import { requireAuthorizedTenant, stripTenantOwnershipFields } from '@/lib/tenant-context';
export const runtime = 'nodejs';

const iso = (d: unknown): string | null => (d ? new Date(d as string).toISOString() : null);
const num = (v: unknown): number | null => {
  if (v == null || v === '') return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
};

export async function GET(req: NextRequest, props: { params: Promise<{ id: string }> }) {
  const params = await props.params;

  const authz = requireAuthorizedTenant({ headers: req.headers, nextUrl: req.nextUrl });

  if (!authz.ok) {

    return NextResponse.json({ error: authz.error }, { status: authz.status });

  }

  const { tenantId } = authz;

  return withTenantRls(prisma, tenantId, async (tx) => {

      try {
        // Single parallel batch: shipment header (with the carrier name folded in
        // via LEFT JOIN) alongside stops, events and PODs. One DB round-trip total
        // instead of fetch-shipment-then-fetch-children (was two), and one fewer
        // query than the previous separate carrier lookup.
        const [shipRows, stopRows, eventRows, podRows] = await Promise.all([
          tx.$queryRawUnsafe<Array<Record<string, unknown>>>(
            `SELECT so.*, c.name AS carrier_name
               FROM logistics_shipment_orders so
               LEFT JOIN logistics_carriers c
                 ON c.id = so.assigned_carrier_id AND c.tenant_id = so.tenant_id
              WHERE so.id = $1 AND so.deleted_at IS NULL AND so.tenant_id = $2
              LIMIT 1`,
            params.id, tenantId,
          ).catch(() => []),
          tx.$queryRawUnsafe<Array<Record<string, unknown>>>(
            `SELECT id, sequence_no, stop_type, location_name, address, contact_name, contact_phone,
                    planned_arrival_at, planned_depart_at, actual_arrival_at, actual_depart_at, status, instructions
               FROM logistics_shipment_stops
              WHERE tenant_id = $1 AND shipment_order_id = $2
              ORDER BY sequence_no ASC`,
            tenantId, params.id,
          ).catch(() => []),
          tx.$queryRawUnsafe<Array<Record<string, unknown>>>(
            `SELECT id, event_type, status, source, occurred_at, notes, latitude, longitude
               FROM logistics_tracking_events
              WHERE tenant_id = $1 AND shipment_order_id = $2
              ORDER BY occurred_at DESC
              LIMIT 200`,
            tenantId, params.id,
          ).catch(() => []),
          tx.$queryRawUnsafe<Array<Record<string, unknown>>>(
            `SELECT id, delivered_at, recipient_name, status, signature_url, photo_urls, document_urls, created_at
               FROM logistics_pod_events
              WHERE tenant_id = $1 AND shipment_order_id = $2
              ORDER BY created_at DESC
              LIMIT 50`,
            tenantId, params.id,
          ).catch(() => []),
        ]);

        const ship = shipRows[0];
        if (!ship) return NextResponse.json({ error: 'Shipment not found' }, { status: 404 });

        const data = {
          shipment: {
            id: ship.id,
            shipmentNo: ship.shipment_no,
            status: ship.status,
            shipmentType: ship.shipment_type,
            priority: ship.priority,
            customerName: ship.cargo_owner_name,
            carrierName: (ship.carrier_name as string) ?? null,
            requestedVehicleType: ship.requested_vehicle_type,
            originName: ship.origin_name,
            originAddress: ship.origin_address,
            destinationName: ship.destination_name,
            destinationAddress: ship.destination_address,
            pickupWindowFrom: iso(ship.pickup_window_from),
            pickupWindowTo: iso(ship.pickup_window_to),
            deliveryWindowFrom: iso(ship.delivery_window_from),
            deliveryWindowTo: iso(ship.delivery_window_to),
            totalWeightKg: num(ship.total_weight_kg),
            totalVolumeCbm: num(ship.total_volume_cbm),
            customerRateAmount: num(ship.customer_rate_amount),
            currency: ship.currency,
            notes: ship.notes,
            // Shipper-declared cargo classification (haulage / customs / hazmat).
            // Stored as jsonb; passed through as-is so the shared panel component
            // can decide what to render. Legacy orders without this bag return {}.
            metadata: (ship.metadata ?? null) as Record<string, unknown> | null,
          },
          stops: stopRows.map(s => ({
            id: s.id as string,
            sequenceNo: Number(s.sequence_no ?? 0),
            stopType: s.stop_type as string,
            locationName: (s.location_name as string) ?? null,
            address: (s.address as string) ?? null,
            contactName: (s.contact_name as string) ?? null,
            contactPhone: (s.contact_phone as string) ?? null,
            plannedArrivalAt: iso(s.planned_arrival_at),
            plannedDepartAt: iso(s.planned_depart_at),
            actualArrivalAt: iso(s.actual_arrival_at),
            actualDepartAt: iso(s.actual_depart_at),
            status: s.status as string,
            instructions: (s.instructions as string) ?? null,
          })),
          events: eventRows.map(e => ({
            id: e.id as string,
            type: e.event_type as string,
            status: (e.status as string) ?? null,
            source: (e.source as string) ?? null,
            at: iso(e.occurred_at),
            notes: (e.notes as string) ?? null,
            latitude: num(e.latitude),
            longitude: num(e.longitude),
          })),
          pods: podRows.map(p => ({
            id: p.id as string,
            deliveredAt: iso(p.delivered_at),
            recipientName: (p.recipient_name as string) ?? null,
            status: p.status as string,
            signatureUrl: (p.signature_url as string) ?? null,
            photoUrls: Array.isArray(p.photo_urls) ? (p.photo_urls as string[]) : [],
            documentUrls: Array.isArray(p.document_urls) ? (p.document_urls as string[]) : [],
            createdAt: iso(p.created_at),
          })),
        };

        return NextResponse.json({ data }, { headers: { 'Cache-Control': 'no-store' } });
        } catch (e) {
        console.error('[logistics/control-tower/:id GET]', e);
        return NextResponse.json(
          { error: e instanceof Error ? e.message : 'failed to load shipment detail' },
          { status: 500 },
        );
      }
  });
}

