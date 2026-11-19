export const dynamic = 'force-dynamic';

import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { withTenantRls } from '@/lib/rls';
import { requireAuthorizedTenant, stripTenantOwnershipFields } from '@/lib/tenant-context';
import {
  matchConsolidatedBackhaulLoads,
  ConsolidationShipmentCandidate,
} from '@/lib/load-consolidation-engine';

async function loadTenantConsolidationCandidates(tenantId: string): Promise<ConsolidationShipmentCandidate[]> {
  const rows = await withTenantRls(prisma, tenantId, async (tx) => {
    return tx.$queryRawUnsafe<Array<{
      id: string;
      shipment_no: string;
      cargo_owner_name: string | null;
      origin_name: string | null;
      origin_address: string | null;
      destination_name: string | null;
      destination_address: string | null;
      total_weight_kg: string | number | null;
      total_volume_cbm: string | number | null;
      cargo_pieces: string | number | null;
      customer_rate_amount: string | number | null;
      metadata: Record<string, unknown> | null;
      pickup_window_from: Date | null;
      delivery_window_to: Date | null;
    }>>(
      `SELECT so.id, so.shipment_no, so.cargo_owner_name,
              so.origin_name, so.origin_address,
              so.destination_name, so.destination_address,
              so.total_weight_kg, so.total_volume_cbm,
              so.customer_rate_amount, so.metadata,
              so.pickup_window_from, so.delivery_window_to,
              COALESCE((SELECT SUM(cl.quantity) FROM logistics_cargo_lines cl
                         WHERE cl.shipment_order_id = so.id AND cl.tenant_id = so.tenant_id), 0) AS cargo_pieces
         FROM logistics_shipment_orders so
        WHERE so.tenant_id = $1
          AND so.deleted_at IS NULL
          AND so.status IN ('PENDING', 'SUBMITTED', 'APPROVED')
        ORDER BY so.created_at DESC
        LIMIT 50`,
      tenantId,
    );
  });

  return rows.map((r) => ({
    shipmentRef: r.shipment_no,
    shipperName: r.cargo_owner_name || 'Tenant Shipper',
    originCorridor: r.origin_name || r.origin_address || 'Unspecified Origin',
    destinationCorridor: r.destination_name || r.destination_address || 'Unspecified Destination',
    pickupDate: r.pickup_window_from ? r.pickup_window_from.toISOString().slice(0, 10) : new Date().toISOString().slice(0, 10),
    weightKg: Number(r.total_weight_kg ?? 0),
    volumeCbm: Number(r.total_volume_cbm ?? 0),
    palletCount: Number(r.metadata?.totalPieces ?? r.metadata?.palletCount ?? r.cargo_pieces ?? 0),
    cargoType: typeof r.metadata?.cargoCategory === 'string' ? r.metadata.cargoCategory : 'General',
    standaloneRateAed: Number(r.customer_rate_amount ?? 0),
  }));
}

export async function GET(req: NextRequest) {
  const auth = requireAuthorizedTenant(req);
  if (!auth.ok) {
    return NextResponse.json({ error: auth.error }, { status: auth.status });
  }

  try {
    const maxWeightKg = Number(req.nextUrl.searchParams.get('maxWeightKg') || 15000);
    const maxVolumeCbm = Number(req.nextUrl.searchParams.get('maxVolumeCbm') || 65);
    const candidates = await loadTenantConsolidationCandidates(auth.tenantId);

    if (candidates.length === 0) {
      return NextResponse.json({
        ok: false,
        error: 'No eligible shipment orders found for load consolidation',
        message: 'Create pending/approved shipment orders or pass candidates in the request body.',
        missingFields: ['logistics_shipment_orders'],
      }, { status: 422 });
    }

    const summary = matchConsolidatedBackhaulLoads(
      candidates,
      maxWeightKg,
      maxVolumeCbm,
    );

    return NextResponse.json({
      success: true,
      candidates,
      summary,
    });
  } catch (err) {
    console.error('[api/logistics/consolidation/match GET]', err);
    return NextResponse.json({ error: 'Consolidation matching failed' }, { status: 500 });
  }
}

export async function POST(req: NextRequest) {
  const auth = requireAuthorizedTenant(req);
  if (!auth.ok) {
    return NextResponse.json({ error: auth.error }, { status: auth.status });
  }

  try {
    const rawBody = await req.json().catch(() => ({}));
    const body = stripTenantOwnershipFields(rawBody);
    const candidates: ConsolidationShipmentCandidate[] =
      Array.isArray(body?.candidates) && body.candidates.length > 0
        ? body.candidates
        : await loadTenantConsolidationCandidates(auth.tenantId);

    if (candidates.length === 0) {
      return NextResponse.json({
        ok: false,
        error: 'No eligible shipment orders found for load consolidation',
        message: 'Create pending/approved shipment orders or pass candidates in the request body.',
        missingFields: ['logistics_shipment_orders'],
      }, { status: 422 });
    }

    const maxWeightKg = Number(body?.maxWeightKg || 15000);
    const maxVolumeCbm = Number(body?.maxVolumeCbm || 65);

    const summary = matchConsolidatedBackhaulLoads(candidates, maxWeightKg, maxVolumeCbm);

    return NextResponse.json({
      success: true,
      summary,
    });
  } catch (err) {
    console.error('[api/logistics/consolidation/match POST]', err);
    return NextResponse.json({ error: 'Consolidation matching failed' }, { status: 500 });
  }
}
