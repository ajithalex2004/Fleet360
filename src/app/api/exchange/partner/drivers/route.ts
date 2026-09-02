export const dynamic = 'force-dynamic';

import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { PartnerService } from '@/lib/exchange/partner-service';

export const runtime = 'nodejs';

/**
 * GET /api/exchange/partner/drivers?partnerId=...
 * POST /api/exchange/partner/drivers
 */
export async function GET(req: NextRequest) {
  const { searchParams } = new URL(req.url);
  const partnerId = searchParams.get('partnerId');

  const where = partnerId ? { partnerId, isActive: true } : { isActive: true };
  const drivers = await prisma.partnerDriver.findMany({
    where,
    orderBy: { createdAt: 'desc' },
  });

  return NextResponse.json({ drivers });
}

export async function POST(req: NextRequest) {
  try {
    const body = await req.json().catch(() => ({}));
    const { partnerId, fullName, mobileNumber, licenseNumber, licenseExpiry, permitType, permitExpiry } = body;

    if (!partnerId || !fullName || !mobileNumber) {
      return NextResponse.json({ error: 'Missing required driver fields' }, { status: 400 });
    }

    const driver = await PartnerService.registerDriver({
      partnerId,
      fullName,
      mobileNumber,
      licenseNumber,
      licenseExpiry,
      permitType,
      permitExpiry,
    });

    return NextResponse.json({ ok: true, driver });
  } catch (err) {
    return NextResponse.json({ error: err instanceof Error ? err.message : 'Failed to register driver' }, { status: 500 });
  }
}
