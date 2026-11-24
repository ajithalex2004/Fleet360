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
    const items = Array.isArray(body.items) ? body.items : [];

    let sum = new Prisma.Decimal(0);
    for (const item of items) {
      if (item && item.amount !== undefined && !isNaN(Number(item.amount))) {
        sum = sum.plus(new Prisma.Decimal(String(item.amount)));
      }
    }

    let num = sum.toNumber();
    if (Math.abs(num) < 0.0005 || Object.is(num, -0)) {
      num = 0;
    } else {
      num = Number(sum.toFixed(4));
    }

    return NextResponse.json({
      success: true,
      total: num,
    });
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    return NextResponse.json({ error: msg }, { status: 400 });
  }
}
