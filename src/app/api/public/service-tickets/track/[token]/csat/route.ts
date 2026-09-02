export const dynamic = 'force-dynamic';

import { NextRequest, NextResponse } from 'next/server';
import { submitTicketCsatFeedback } from '@/lib/service-tickets/csat-analytics-engine';

export const runtime = 'nodejs';

/**
 * POST /api/public/service-tickets/track/[token]/csat
 * Public endpoint to submit 1–5 star CSAT feedback and optional comments
 */
export async function POST(
  req: NextRequest,
  props: { params: Promise<{ token: string }> }
) {
  const params = await props.params;
  const { token } = params;

  try {
    const body = await req.json();
    const { rating, comment } = body;

    if (typeof rating !== 'number' || rating < 1 || rating > 5) {
      return NextResponse.json(
        { error: 'Valid rating between 1 and 5 is required' },
        { status: 400 }
      );
    }

    const result = await submitTicketCsatFeedback(token, rating, comment);
    return NextResponse.json(result);
  } catch (err) {
    console.error(`POST /api/public/service-tickets/track/${token}/csat error:`, err);
    return NextResponse.json(
      { error: err instanceof Error ? err.message : 'Failed to submit CSAT feedback' },
      { status: 500 }
    );
  }
}
