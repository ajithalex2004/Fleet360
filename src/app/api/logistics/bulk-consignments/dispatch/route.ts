export const dynamic = 'force-dynamic';

import crypto from 'crypto';
import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { withTenantRls } from '@/lib/rls';
import { requireAuthorizedTenant, stripTenantOwnershipFields } from '@/lib/tenant-context';
import { dispatchBulkConsignments, ValidatedConsignmentRow } from '@/lib/bulk-consignment-engine';

export async function POST(req: NextRequest) {
  const auth = requireAuthorizedTenant(req);
  if (!auth.ok) {
    return NextResponse.json({ error: auth.error }, { status: auth.status });
  }

  try {
    const rawBody = await req.json();
    const body = stripTenantOwnershipFields(rawBody);
    const { rows = [], batchId = `BCH-${Date.now()}` } = body as {
      rows: ValidatedConsignmentRow[];
      batchId: string;
    };

    if (!Array.isArray(rows) || rows.length === 0) {
      return NextResponse.json({ error: 'No validated rows provided for dispatch' }, { status: 400 });
    }

    const result = dispatchBulkConsignments(rows, batchId);

    const persistedIds: string[] = [];
    await withTenantRls(prisma, auth.tenantId, async (tx) => {
      for (const row of rows.filter((r) => r.isValid !== false)) {
        const id = crypto.randomUUID();
        const shipmentNo = row.consignmentRef?.trim() || `SHP-${Date.now()}-${persistedIds.length + 1}`;
        await tx.$executeRawUnsafe(
          `INSERT INTO logistics_shipment_orders (
             id, tenant_id, shipment_no, status, shipment_type,
             cargo_owner_name, origin_name, origin_address,
             destination_name, destination_address,
             total_weight_kg, total_pieces, notes,
             metadata, created_at, updated_at
           ) VALUES (
             $1, $2, $3, 'APPROVED', 'LTL',
             $4, $5, $5,
             $6, $7,
             $8, $9, $10,
             $11::jsonb, NOW(), NOW()
           )
           ON CONFLICT DO NOTHING`,
          id,
          auth.tenantId,
          shipmentNo,
          row.shipperName || 'Bulk Consignment Shipper',
          row.originLocation || 'JAFZA Hub',
          row.consigneeName || 'Consignee',
          row.destinationAddress || 'Dubai',
          Number(row.grossWeightKg ?? 0),
          Number(row.palletCount ?? 1),
          `Batch ${batchId} (${row.cargoCategory ?? 'General'})`,
          JSON.stringify({
            batchId,
            customsDecNo: row.customsDecNo ?? null,
            receiverContactName: row.receiverContactName ?? null,
            receiverPhone: row.receiverPhone ?? null,
            costCenter: row.costCenter ?? null,
          }),
        );
        persistedIds.push(id);
      }
    }).catch((dbErr) => {
      console.warn('[api/logistics/bulk-consignments/dispatch POST] DB persistence skipped:', dbErr);
    });

    return NextResponse.json({
      success: true,
      persistedCount: persistedIds.length,
      persistedShipmentIds: persistedIds,
      result,
    });
  } catch (err) {
    console.error('[api/logistics/bulk-consignments/dispatch POST]', err);
    return NextResponse.json({ error: 'Failed to dispatch bulk consignments' }, { status: 500 });
  }
}
