export const dynamic = 'force-dynamic';

import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { PartnerService } from '@/lib/exchange/partner-service';

export const runtime = 'nodejs';

/**
 * GET /api/exchange/partner/compliance?partnerId=...
 * POST /api/exchange/partner/compliance
 */
export async function GET(req: NextRequest) {
  const { searchParams } = new URL(req.url);
  const partnerId = searchParams.get('partnerId');

  const where = partnerId ? { partnerId } : {};
  const documents = await prisma.partnerComplianceDoc.findMany({
    where,
    orderBy: { createdAt: 'desc' },
  });

  return NextResponse.json({ documents });
}

export async function POST(req: NextRequest) {
  try {
    const body = await req.json().catch(() => ({}));
    const { partnerId, docType, docNumber, fileUrl, expiryDate } = body;

    if (!partnerId || !docType || !fileUrl) {
      return NextResponse.json({ error: 'Missing required compliance document fields' }, { status: 400 });
    }

    const doc = await PartnerService.uploadComplianceDoc({
      partnerId,
      docType,
      docNumber,
      fileUrl,
      expiryDate,
    });

    return NextResponse.json({ ok: true, document: doc });
  } catch (err) {
    return NextResponse.json({ error: err instanceof Error ? err.message : 'Failed to upload document' }, { status: 500 });
  }
}
