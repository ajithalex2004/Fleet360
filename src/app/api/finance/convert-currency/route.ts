import { NextRequest, NextResponse } from 'next/server';
import { Prisma } from '@prisma/client';
import { requireAuthorizedTenant } from '@/lib/tenant-context';

export const dynamic = 'force-dynamic';

export async function POST(req: NextRequest) {
  const authz = requireAuthorizedTenant({ headers: req.headers, nextUrl: req.nextUrl });
  if (!authz.ok) {
    return NextResponse.json({ error: authz.error }, { status: authz.status });
  }

  try {
    const body = await req.json().catch(() => ({}));
    const amountUSD = new Prisma.Decimal(String(body.amountUSD ?? 0));
    const rate = new Prisma.Decimal(String(body.rate ?? 3.6725));

    const amountAED = Number(amountUSD.times(rate).toFixed(2));

    return NextResponse.json({
      success: true,
      amountUSD: amountUSD.toNumber(),
      rate: rate.toNumber(),
      amountAED,
    });
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    return NextResponse.json({ error: msg }, { status: 400 });
  }
}
