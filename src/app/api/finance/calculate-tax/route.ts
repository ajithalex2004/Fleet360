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
    const amount = new Prisma.Decimal(String(body.amount ?? 0));
    const rate = new Prisma.Decimal(String(body.rate ?? 0.05));

    const taxDecimal = amount.times(rate);
    const roundedTax = Number(taxDecimal.toFixed(2));

    return NextResponse.json({
      success: true,
      amount: amount.toNumber(),
      rate: rate.toNumber(),
      tax: roundedTax,
    });
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    return NextResponse.json({ error: msg }, { status: 400 });
  }
}
