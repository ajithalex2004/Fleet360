export const dynamic = 'force-dynamic';

import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';

export const runtime = 'nodejs';

/**
 * GET /api/exchange/jobs/awards?partnerId=...
 *
 * Lists all awarded outsourced jobs for the partner.
 */
export async function GET(req: NextRequest) {
  const { searchParams } = new URL(req.url);
  const partnerId = searchParams.get('partnerId');

  const where = partnerId ? { partnerId } : {};
  const awards = await prisma.outsourceAward.findMany({
    where,
    include: {
      request: true,
      quote: true,
      assignment: {
        include: { pod: true },
      },
      invoice: true,
    },
    orderBy: { awardedAt: 'desc' },
  });

  return NextResponse.json({ awards });
}
