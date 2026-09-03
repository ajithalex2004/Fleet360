export const dynamic = 'force-dynamic';

import { NextRequest, NextResponse } from 'next/server';
import {
  analyzeBulkConsignmentUpload,
  SAMPLE_BULK_CSV_CONTENT,
} from '@/lib/bulk-consignment-engine';

export async function GET(req: NextRequest) {
  // Returns analysis of sample manifest
  const analysis = analyzeBulkConsignmentUpload('sample_retail_manifest_10_stores.csv', SAMPLE_BULK_CSV_CONTENT);
  return NextResponse.json({
    success: true,
    analysis,
  });
}

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
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
