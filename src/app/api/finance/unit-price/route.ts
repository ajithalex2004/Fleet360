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
    const total = Number(body.total ?? 0);
    const quantity = Number(body.quantity ?? 0);

    if (isNaN(quantity) || quantity === 0) {
      return NextResponse.json(
        { ok: false, error: 'Quantity must be non-zero to calculate unit price' },
        { status: 422 },
      );
    }

    const totalDec = new Prisma.Decimal(String(total));
    const qtyDec = new Prisma.Decimal(String(quantity));
    const unitPrice = Number(totalDec.dividedBy(qtyDec).toFixed(2));

    return NextResponse.json({
      success: true,
      total,
      quantity,
      unitPrice,
    });
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    return NextResponse.json({ error: msg }, { status: 400 });
  }
}
