export const dynamic = 'force-dynamic';

import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { ScorecardService } from '@/lib/exchange/scorecard-service';

export const runtime = 'nodejs';

/**
 * GET /api/exchange/scorecard?partnerId=...
 * POST /api/exchange/scorecard
 */
export async function GET(req: NextRequest) {
  try {
    let partnerId = req.headers.get('x-partner-id') || req.nextUrl.searchParams.get('partnerId');

    if (!partnerId) {
      const defaultPartner = await prisma.transportPartner.findFirst({
        where: { operationalStatus: 'ACTIVE', deletedAt: null },
      });
      if (!defaultPartner) {
        return NextResponse.json({ scorecard: null });
      }
      partnerId = defaultPartner.id;
    }

    const scorecard = await ScorecardService.getPartnerScorecard(partnerId);
    return NextResponse.json({ scorecard });
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : 'Failed to fetch partner scorecard' },
      { status: 500 }
    );
  }
}

export async function POST(req: NextRequest) {
  try {
    const rawBody = await req.json().catch(() => ({}));
    const { partnerId } = rawBody;

    if (!partnerId) {
      return NextResponse.json({ error: 'partnerId is required' }, { status: 400 });
    }

    const evaluation = await ScorecardService.evaluatePartnerScorecard(partnerId);
    return NextResponse.json({ ok: true, evaluation });
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : 'Failed to recalculate scorecard' },
      { status: 500 }
    );
  }
}
