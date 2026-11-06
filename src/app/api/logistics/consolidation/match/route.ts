export const dynamic = 'force-dynamic';

import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { withTenantRls } from '@/lib/rls';
import { requireAuthorizedTenant, stripTenantOwnershipFields } from '@/lib/tenant-context';
import {
  matchConsolidatedBackhaulLoads,
  SAMPLE_CONSOLIDATION_CANDIDATES,
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
      total_pieces: number | null;
      quoted_price: string | number | null;
      pickup_window_from: Date | null;
      delivery_window_to: Date | null;
    }>>(
      `SELECT id, shipment_no, cargo_owner_name,
              origin_name, origin_address,
              destination_name, destination_address,
              total_weight_kg, total_volume_cbm, total_pieces,
              quoted_price, pickup_window_from, delivery_window_to
         FROM logistics_shipment_orders
        WHERE tenant_id = $1
          AND deleted_at IS NULL
          AND status IN ('PENDING', 'SUBMITTED', 'APPROVED')
        ORDER BY created_at DESC
        LIMIT 50`,
      tenantId,
    );
  }).catch(() => []);

  if (!rows.length) return SAMPLE_CONSOLIDATION_CANDIDATES;

  return rows.map((r) => ({
    shipmentRef: r.shipment_no,
    shipperName: r.cargo_owner_name || 'Tenant Shipper',
    originCorridor: r.origin_name || r.origin_address || 'JAFZA South',
    destinationCorridor: r.destination_name || r.destination_address || 'Abu Dhabi / KEZAD',
    pickupDate: r.pickup_window_from ? r.pickup_window_from.toISOString().slice(0, 10) : new Date().toISOString().slice(0, 10),
    weightKg: Number(r.total_weight_kg ?? 1200) || 1200,
    volumeCbm: Number(r.total_volume_cbm ?? 6) || 6,
    palletCount: Number(r.total_pieces ?? 4) || 4,
    cargoType: 'Dry Retail',
    standaloneRateAed: Number(r.quoted_price ?? 1450) || 1450,
  }));
}

export async function GET(req: NextRequest) {
  const auth = requireAuthorizedTenant(req);
  if (!auth.ok) {
    return NextResponse.json({ error: auth.error }, { status: auth.status });
  }

  const maxWeightKg = Number(req.nextUrl.searchParams.get('maxWeightKg') || 15000);
  const maxVolumeCbm = Number(req.nextUrl.searchParams.get('maxVolumeCbm') || 65);
  const candidates = await loadTenantConsolidationCandidates(auth.tenantId);

  const summary = matchConsolidatedBackhaulLoads(
    candidates,
    maxWeightKg,
    maxVolumeCbm
  );

  return NextResponse.json({
    success: true,
    candidates,
    summary,
  });
}

export async function POST(req: NextRequest) {
  const auth = requireAuthorizedTenant(req);
  if (!auth.ok) {
    return NextResponse.json({ error: auth.error }, { status: auth.status });
  }

  try {
    const rawBody = await req.json();
    const body = stripTenantOwnershipFields(rawBody);
    const candidates: ConsolidationShipmentCandidate[] =
      Array.isArray(body?.candidates) && body.candidates.length > 0
        ? body.candidates
        : await loadTenantConsolidationCandidates(auth.tenantId);

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
