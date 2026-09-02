export const dynamic = 'force-dynamic';

import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { MarketplaceService } from '@/lib/exchange/marketplace-service';

export const runtime = 'nodejs';

/**
 * GET /api/exchange/marketplace
 * Discovers open marketplace opportunities for the current partner session
 */
export async function GET(req: NextRequest) {
  try {
    const partnerId = req.headers.get('x-partner-id') || req.nextUrl.searchParams.get('partnerId');

    if (!partnerId) {
      // Find default active marketplace partner for fallback
      const defaultPartner = await prisma.transportPartner.findFirst({
        where: { marketplaceStatus: 'APPROVED', operationalStatus: 'ACTIVE', deletedAt: null },
      });
      if (!defaultPartner) {
        return NextResponse.json({ opportunities: [] });
      }
      const res = await MarketplaceService.listOpportunitiesForPartner(defaultPartner.id);
      return NextResponse.json(res);
    }

    const res = await MarketplaceService.listOpportunitiesForPartner(partnerId);
    return NextResponse.json(res);
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : 'Failed to fetch marketplace opportunities' },
      { status: 500 }
    );
  }
}
