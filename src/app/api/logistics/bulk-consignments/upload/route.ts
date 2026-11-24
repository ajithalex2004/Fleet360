export const dynamic = 'force-dynamic';

import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { withTenantRls } from '@/lib/rls';
import { requireAuthorizedTenant, stripTenantOwnershipFields } from '@/lib/tenant-context';
import {
  validateBulkConsignmentBatch,
  parseBulkConsignmentsCsv,
  BulkConsignmentRowInput,
} from '@/lib/bulk-consignment-engine';

export async function GET(req: NextRequest) {
  const auth = requireAuthorizedTenant(req);
  if (!auth.ok) {
    return NextResponse.json({ error: auth.error }, { status: auth.status });
  }

  try {
    const rows = await withTenantRls(prisma, auth.tenantId, async (tx) => {
      return tx.$queryRawUnsafe<Array<{
        shipment_no: string;
        cargo_owner_name: string | null;
        origin_name: string | null;
        origin_address: string | null;
        destination_name: string | null;
        destination_address: string | null;
        pickup_window_from: Date | null;
        total_weight_kg: string | number | null;
        metadata: Record<string, unknown> | null;
      }>>(
        `SELECT shipment_no, cargo_owner_name, origin_name, origin_address,
                destination_name, destination_address, pickup_window_from,
                total_weight_kg, metadata
           FROM logistics_shipment_orders
          WHERE tenant_id = $1
            AND deleted_at IS NULL
            AND metadata->>'batchId' IS NOT NULL
          ORDER BY created_at DESC
          LIMIT 100`,
        auth.tenantId,
      );
    });

    if (rows.length === 0) {
      return NextResponse.json({
        ok: false,
        error: 'No bulk consignment batches found for tenant',
        missingFields: ['consignments'],
      }, { status: 422 });
    }

    const inputs: BulkConsignmentRowInput[] = rows.map((r) => ({
      consignmentRef: r.shipment_no,
      shipperName: r.cargo_owner_name || undefined,
      originLocation: r.origin_name || r.origin_address || undefined,
      consigneeName: typeof r.metadata?.consigneeName === 'string' ? r.metadata.consigneeName : r.destination_name || undefined,
      destinationAddress: r.destination_address || r.destination_name || undefined,
      deliveryDate: r.pickup_window_from ? r.pickup_window_from.toISOString().slice(0, 10) : undefined,
      palletCount: r.metadata?.palletCount != null ? Number(r.metadata.palletCount) : undefined,
      grossWeightKg: r.total_weight_kg != null ? Number(r.total_weight_kg) : undefined,
      cargoCategory: typeof r.metadata?.cargoCategory === 'string' ? r.metadata.cargoCategory : undefined,
    }));

    const batchSummary = validateBulkConsignmentBatch(inputs);
    return NextResponse.json({
      success: true,
      rows: inputs,
      batchSummary,
    });
  } catch (err) {
    console.error('[api/logistics/bulk-consignments/upload GET]', err);
    return NextResponse.json({ error: 'Failed to load bulk consignments' }, { status: 500 });
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

    let rows: BulkConsignmentRowInput[] = [];
    if (Array.isArray(body?.rows) && body.rows.length > 0) {
      rows = body.rows as BulkConsignmentRowInput[];
    } else if (typeof body?.csvContent === 'string' && body.csvContent.trim().length > 0) {
      rows = parseBulkConsignmentsCsv(body.csvContent);
    }

    if (rows.length === 0) {
      return NextResponse.json({
        ok: false,
        error: 'Consignment rows or csvContent are required',
        missingFields: ['rows'],
      }, { status: 422 });
    }

    const batchSummary = validateBulkConsignmentBatch(rows);

    return NextResponse.json({
      success: true,
      batchSummary,
    });
  } catch (err) {
    console.error('[api/logistics/bulk-consignments/upload POST]', err);
    return NextResponse.json({ error: 'Failed to validate bulk consignments' }, { status: 500 });
  }
}
