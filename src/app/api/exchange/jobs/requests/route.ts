export const dynamic = 'force-dynamic';

import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';

export const runtime = 'nodejs';

/**
 * GET /api/exchange/jobs/requests?partnerId=...
 *
 * Lists all open outsource requests where this partner is invited or all published requests.
 */
export async function GET(req: NextRequest) {
  const { searchParams } = new URL(req.url);
  const partnerId = searchParams.get('partnerId');

  const requests = await prisma.outsourceRequest.findMany({
    where: {
      status: { in: ['PUBLISHED', 'QUOTED'] },
      closesAt: { gt: new Date() },
      OR: partnerId
        ? [
            { invitedPartners: { some: { partnerId } } },
            { invitedPartners: { none: {} } },
          ]
        : undefined,
    },
    include: {
      invitedPartners: true,
      quotes: partnerId ? { where: { partnerId } } : true,
    },
    orderBy: { createdAt: 'desc' },
  });

  return NextResponse.json({ requests });
}
