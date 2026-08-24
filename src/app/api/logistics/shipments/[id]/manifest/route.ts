import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { fetchShipmentById } from '@/lib/logistics/domain';

import { requireAuthorizedTenant } from '@/lib/tenant-context';
export const runtime = 'nodejs';

interface CargoItem { desc: string; qty: number; unit: string; weightKg?: number | null }

interface ManifestBody {
  action?: 'add_stop' | 'update_stop' | 'confirm_delivery' | 'reorder';
  stopId?: string;
  stopNumber?: number;
  stopName?: string;
  stopAddress?: string;
  recipient?: string;
  recipientPhone?: string;
  cargoItems?: CargoItem[];
  status?: 'PENDING' | 'DELIVERED' | 'SKIPPED';
  deliveryNote?: string;
  signatureB64?: string;
  order?: Array<{ stopId: string; stopNumber: number }>;
}

async function ensureTable() {
  await prisma.$executeRawUnsafe(`
    CREATE TABLE IF NOT EXISTS logistics_shipment_manifest_stops (
      id TEXT PRIMARY KEY DEFAULT gen_random_uuid()::text,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      tenant_id TEXT NOT NULL,
      shipment_order_id TEXT NOT NULL,
      stop_number INT NOT NULL DEFAULT 1,
      stop_name TEXT,
      stop_address TEXT,
      recipient TEXT,
      recipient_phone TEXT,
      cargo_items JSONB NOT NULL DEFAULT '[]',
      status TEXT NOT NULL DEFAULT 'PENDING',
      delivered_at TIMESTAMPTZ,
      delivery_note TEXT,
      signature_b64 TEXT,
      metadata JSONB
    )
  `);
  await prisma.$executeRawUnsafe(`
    CREATE INDEX IF NOT EXISTS idx_logistics_shipment_manifest_stops
      ON logistics_shipment_manifest_stops (tenant_id, shipment_order_id, stop_number)
  `);
}

async function loadCargo(tenantId: string, shipmentOrderId: string): Promise<CargoItem[]> {
  const rows = await prisma.$queryRawUnsafe<Array<{
    description: string;
    quantity: string | number | null;
    package_type: string | null;
    weight_kg: string | number | null;
  }>>(
    `SELECT description, quantity, package_type, weight_kg
       FROM logistics_cargo_lines
      WHERE tenant_id = $1 AND shipment_order_id = $2
      ORDER BY created_at ASC`,
    tenantId,
    shipmentOrderId,
  ).catch(() => []);

  return rows.map(row => ({
    desc: row.description,
    qty: Number(row.quantity ?? 1),
    unit: row.package_type ?? 'unit',
    weightKg: row.weight_kg != null ? Number(row.weight_kg) : null,
  }));
}

export async function GET(req: NextRequest, { params }: { params: { id: string } }) {
  const authz = requireAuthorizedTenant({ headers: req.headers, nextUrl: req.nextUrl });

  if (!authz.ok) {

    return NextResponse.json({ error: authz.error }, { status: authz.status });

  }

  const { tenantId } = authz;, { status: 401 });

  const shipment = await fetchShipmentById(params.id, tenantId);
  if (!shipment) return NextResponse.json({ error: 'Shipment not found' }, { status: 404 });

  await ensureTable();
  const manifestRows = await prisma.$queryRawUnsafe<Array<{
    id: string;
    stop_number: number;
    stop_name: string | null;
    stop_address: string | null;
    recipient: string | null;
    recipient_phone: string | null;
    cargo_items: unknown;
    status: string;
    delivered_at: Date | null;
    delivery_note: string | null;
    signature_b64: string | null;
  }>>(
    `SELECT id, stop_number, stop_name, stop_address, recipient, recipient_phone,
            cargo_items, status, delivered_at, delivery_note, signature_b64
       FROM logistics_shipment_manifest_stops
      WHERE tenant_id = $1 AND shipment_order_id = $2
      ORDER BY stop_number ASC`,
    tenantId,
    params.id,
  );

  let stops = manifestRows.map(row => ({
    id: row.id,
    stop_number: row.stop_number,
    stop_name: row.stop_name,
    stop_address: row.stop_address,
    recipient: row.recipient,
    recipient_phone: row.recipient_phone,
    cargo_items: Array.isArray(row.cargo_items) ? row.cargo_items : [],
    status: row.status,
    delivered_at: row.delivered_at ? row.delivered_at.toISOString() : null,
    delivery_note: row.delivery_note,
    signature_b64: row.signature_b64,
  }));

  if (stops.length === 0) {
    const cargo = await loadCargo(tenantId, params.id);
    const nativeStops = await prisma.$queryRawUnsafe<Array<{
      id: string;
      sequence_no: number;
      stop_type: string;
      location_name: string | null;
      address: string | null;
      contact_name: string | null;
      contact_phone: string | null;
      status: string;
      actual_arrival_at: Date | null;
      instructions: string | null;
    }>>(
      `SELECT id, sequence_no, stop_type, location_name, address, contact_name,
              contact_phone, status, actual_arrival_at, instructions
         FROM logistics_shipment_stops
        WHERE tenant_id = $1 AND shipment_order_id = $2
        ORDER BY sequence_no ASC`,
      tenantId,
      params.id,
    ).catch(() => []);

    stops = nativeStops.length > 0
      ? nativeStops.map(stop => ({
          id: stop.id,
          stop_number: stop.sequence_no,
          stop_name: stop.location_name ?? stop.stop_type,
          stop_address: stop.address,
          recipient: stop.contact_name,
          recipient_phone: stop.contact_phone,
          cargo_items: stop.stop_type === 'DELIVERY' ? cargo : [],
          status: normaliseStopStatus(stop.status),
          delivered_at: stop.actual_arrival_at ? stop.actual_arrival_at.toISOString() : null,
          delivery_note: stop.instructions,
          signature_b64: null,
        }))
      : [
          {
            id: `${params.id}-origin`,
            stop_number: 1,
            stop_name: shipment.origin_name ?? 'Origin',
            stop_address: shipment.origin_address,
            recipient: null,
            recipient_phone: null,
            cargo_items: [],
            status: 'PENDING',
            delivered_at: null,
            delivery_note: null,
            signature_b64: null,
          },
          {
            id: `${params.id}-destination`,
            stop_number: 2,
            stop_name: shipment.destination_name ?? 'Destination',
            stop_address: shipment.destination_address,
            recipient: null,
            recipient_phone: null,
            cargo_items: cargo,
            status: 'PENDING',
            delivered_at: null,
            delivery_note: null,
            signature_b64: null,
          },
        ];
  }

  const summary = {
    totalStops: stops.length,
    delivered: stops.filter(stop => stop.status === 'DELIVERED').length,
    pending: stops.filter(stop => stop.status === 'PENDING').length,
    skipped: stops.filter(stop => stop.status === 'SKIPPED').length,
  };

  return NextResponse.json({
    shipment: {
      id: shipment.id,
      shipmentNo: shipment.shipment_no,
      status: shipment.status,
      customerName: shipment.cargo_owner_name,
      origin: shipment.origin_name ?? shipment.origin_address,
      destination: shipment.destination_name ?? shipment.destination_address,
      scheduledDate: shipment.pickup_window_from?.toISOString() ?? null,
    },
    stops,
    summary,
  });
}

export async function POST(req: NextRequest, { params }: { params: { id: string } }) {
  const authz = requireAuthorizedTenant({ headers: req.headers, nextUrl: req.nextUrl });

  if (!authz.ok) {

    return NextResponse.json({ error: authz.error }, { status: authz.status });

  }

  const { tenantId } = authz;, { status: 401 });

  const shipment = await fetchShipmentById(params.id, tenantId);
  if (!shipment) return NextResponse.json({ error: 'Shipment not found' }, { status: 404 });

  let body: ManifestBody;
  try { body = (await req.json()) as ManifestBody; }
  catch { return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 }); }

  await ensureTable();

  if (body.action === 'add_stop') {
    const max = await prisma.$queryRawUnsafe<Array<{ max: number | null }>>(
      `SELECT MAX(stop_number) AS max
         FROM logistics_shipment_manifest_stops
        WHERE tenant_id = $1 AND shipment_order_id = $2`,
      tenantId,
      params.id,
    );
    const stopNumber = body.stopNumber ?? ((max[0]?.max ?? 0) + 1);
    const rows = await prisma.$queryRawUnsafe<Array<{ id: string }>>(
      `INSERT INTO logistics_shipment_manifest_stops
         (tenant_id, shipment_order_id, stop_number, stop_name, stop_address, recipient, recipient_phone, cargo_items, metadata)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8::jsonb,$9::jsonb)
       RETURNING id`,
      tenantId,
      params.id,
      stopNumber,
      body.stopName ?? null,
      body.stopAddress ?? null,
      body.recipient ?? null,
      body.recipientPhone ?? null,
      JSON.stringify(body.cargoItems ?? []),
      JSON.stringify({ source: 'shipment-manifest' }),
    );
    return NextResponse.json({ ok: true, id: rows[0]?.id ?? null, stopNumber }, { status: 201 });
  }

  if (body.action === 'update_stop' && body.stopId) {
    await prisma.$executeRawUnsafe(
      `UPDATE logistics_shipment_manifest_stops
          SET stop_name = COALESCE($4, stop_name),
              stop_address = COALESCE($5, stop_address),
              recipient = COALESCE($6, recipient),
              recipient_phone = COALESCE($7, recipient_phone),
              cargo_items = CASE WHEN $8 IS NOT NULL THEN $8::jsonb ELSE cargo_items END,
              updated_at = NOW()
        WHERE tenant_id = $1 AND shipment_order_id = $2 AND id = $3`,
      tenantId,
      params.id,
      body.stopId,
      body.stopName ?? null,
      body.stopAddress ?? null,
      body.recipient ?? null,
      body.recipientPhone ?? null,
      body.cargoItems ? JSON.stringify(body.cargoItems) : null,
    );
    return NextResponse.json({ ok: true });
  }

  if (body.action === 'confirm_delivery' && body.stopId) {
    await prisma.$executeRawUnsafe(
      `UPDATE logistics_shipment_manifest_stops
          SET status = $4,
              delivered_at = CASE WHEN $4 = 'DELIVERED' THEN NOW() ELSE delivered_at END,
              delivery_note = $5,
              signature_b64 = $6,
              updated_at = NOW()
        WHERE tenant_id = $1 AND shipment_order_id = $2 AND id = $3`,
      tenantId,
      params.id,
      body.stopId,
      body.status ?? 'DELIVERED',
      body.deliveryNote ?? null,
      body.signatureB64 ?? null,
    );
    return NextResponse.json({ ok: true });
  }

  if (body.action === 'reorder' && body.order) {
    for (const item of body.order) {
      await prisma.$executeRawUnsafe(
        `UPDATE logistics_shipment_manifest_stops
            SET stop_number = $4, updated_at = NOW()
          WHERE tenant_id = $1 AND shipment_order_id = $2 AND id = $3`,
        tenantId,
        params.id,
        item.stopId,
        item.stopNumber,
      );
    }
    return NextResponse.json({ ok: true });
  }

  return NextResponse.json({ error: 'Unknown action' }, { status: 400 });
}

export async function DELETE(req: NextRequest, { params }: { params: { id: string } }) {
  const authz = requireAuthorizedTenant({ headers: req.headers, nextUrl: req.nextUrl });

  if (!authz.ok) {

    return NextResponse.json({ error: authz.error }, { status: authz.status });

  }

  const { tenantId } = authz;, { status: 401 });

  const shipment = await fetchShipmentById(params.id, tenantId);
  if (!shipment) return NextResponse.json({ error: 'Shipment not found' }, { status: 404 });

  let body: { stopId?: string };
  try { body = (await req.json()) as { stopId?: string }; }
  catch { return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 }); }

  if (!body.stopId) return NextResponse.json({ error: 'stopId required' }, { status: 400 });
  await ensureTable();
  await prisma.$executeRawUnsafe(
    `DELETE FROM logistics_shipment_manifest_stops
      WHERE tenant_id = $1 AND shipment_order_id = $2 AND id = $3`,
    tenantId,
    params.id,
    body.stopId,
  );
  return NextResponse.json({ ok: true });
}

function normaliseStopStatus(status: string | null) {
  const key = String(status ?? '').toUpperCase();
  if (['ARRIVED', 'DEPARTED', 'COMPLETED', 'DELIVERED'].includes(key)) return 'DELIVERED';
  if (key === 'SKIPPED') return 'SKIPPED';
  return 'PENDING';
}
