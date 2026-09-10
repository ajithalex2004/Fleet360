export const dynamic = 'force-dynamic';

import { NextRequest, NextResponse } from 'next/server';
import { requireAuthorizedTenant, stripTenantOwnershipFields } from '@/lib/tenant-context';
import {
  analyzeBulkConsignmentUpload,
  SAMPLE_BULK_CSV_CONTENT,
} from '@/lib/bulk-consignment-engine';

export async function GET(req: NextRequest) {
  const auth = await requireAuthorizedTenant(req);
  if (auth instanceof NextResponse) return auth;

  // Returns analysis of sample manifest
  const analysis = analyzeBulkConsignmentUpload('sample_retail_manifest_10_stores.csv', SAMPLE_BULK_CSV_CONTENT);
  return NextResponse.json({
    success: true,
    analysis,
  });
}

export async function POST(req: NextRequest) {
  const auth = await requireAuthorizedTenant(req);
  if (auth instanceof NextResponse) return auth;

  try {
    const rawBody = await req.json();
    const body = stripTenantOwnershipFields(rawBody);
    const { fileName = 'uploaded_manifest.csv', csvContent = SAMPLE_BULK_CSV_CONTENT } = body;

    const analysis = analyzeBulkConsignmentUpload(fileName, csvContent);

    return NextResponse.json({
      success: true,
      analysis,
      message: `Parsed ${analysis.totalRows} consignments into ${analysis.clusters.length} optimized vehicle routes.`,
    });
  } catch (err) {
    console.error('[api/logistics/bulk-consignments/upload POST]', err);
    return NextResponse.json({ error: 'Failed to process bulk upload' }, { status: 500 });
  }
}
