export const dynamic = 'force-dynamic';

import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { OutsourceEngine } from '@/lib/exchange/outsource-engine';

export const runtime = 'nodejs';

/**
 * GET /api/exchange/jobs/quotes?partnerId=...
 * POST /api/exchange/jobs/quotes
 */
export async function GET(req: NextRequest) {
  const { searchParams } = new URL(req.url);
  const partnerId = searchParams.get('partnerId');

  const where = partnerId ? { partnerId } : {};
  const quotes = await prisma.partnerQuote.findMany({
    where,
    include: {
      request: true,
      partner: true,
    },
    orderBy: { createdAt: 'desc' },
  });

  return NextResponse.json({ quotes });
}

export async function POST(req: NextRequest) {
  try {
    const body = await req.json().catch(() => ({}));
    const { requestId, partnerId, amount, vatAmount, currency, validHours, proposedVehicleId, proposedDriverId, notes } = body;

    if (!requestId || !partnerId || amount == null) {
      return NextResponse.json({ error: 'requestId, partnerId, and amount are required' }, { status: 400 });
    }

    const quote = await OutsourceEngine.submitOrReviseQuote({
      requestId,
      partnerId,
      amount: Number(amount),
      vatAmount: vatAmount != null ? Number(vatAmount) : undefined,
      currency,
      validHours: validHours ? Number(validHours) : undefined,
      proposedVehicleId,
      proposedDriverId,
      notes,
    });

    return NextResponse.json({ ok: true, quote });
  } catch (err) {
    return NextResponse.json({ error: err instanceof Error ? err.message : 'Failed to submit quote' }, { status: 500 });
  }
}
