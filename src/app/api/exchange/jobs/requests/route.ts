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
      // Note: OutsourceRequest has no closesAt/deadline column in the schema —
      // "still open" is expressed entirely via status (PUBLISHED/QUOTED).
      status: { in: ['PUBLISHED', 'QUOTED'] },
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
      // Needed for the request's quote-submission deadline: OutsourceRequest
      // itself has no closesAt column, that lives on MarketplaceOpportunity.
      opportunity: true,
    },
    orderBy: { createdAt: 'desc' },
  });

  return NextResponse.json({ requests });
}
