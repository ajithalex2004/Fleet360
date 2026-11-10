export const dynamic = 'force-dynamic';

import { NextRequest, NextResponse } from 'next/server';
import { requireAuthorizedTenant, stripTenantOwnershipFields } from '@/lib/tenant-context';
import {
  validateBulkConsignmentBatch,
  SAMPLE_BULK_CONSIGNMENT_CSV_ROWS,
  BulkConsignmentRowInput,
} from '@/lib/bulk-consignment-engine';

export async function GET(req: NextRequest) {
  const auth = requireAuthorizedTenant(req);
  if (!auth.ok) {
    return NextResponse.json({ error: auth.error }, { status: auth.status });
  }

  const batchSummary = validateBulkConsignmentBatch(SAMPLE_BULK_CONSIGNMENT_CSV_ROWS);
  return NextResponse.json({
    success: true,
    sampleRows: SAMPLE_BULK_CONSIGNMENT_CSV_ROWS,
    batchSummary,
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
    const rows: BulkConsignmentRowInput[] =
      Array.isArray(body?.rows) && body.rows.length > 0
        ? body.rows
        : SAMPLE_BULK_CONSIGNMENT_CSV_ROWS;

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
