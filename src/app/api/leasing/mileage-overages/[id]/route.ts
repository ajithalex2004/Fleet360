import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { legacyLeasingBillingWriteMoved } from '@/lib/finance-leasing-billing-routing';
export async function PATCH(req: NextRequest, { params }: { params: { id: string } }) {
  try {
    const moved = legacyLeasingBillingWriteMoved(req, `/api/finance/leasing-billing/mileage-overages/${params.id}`);
    if (moved) return moved;
    const { contract: _ignoredContract, ...data } = await req.json();
    void _ignoredContract;
    const overage = await prisma.leaseMileageOverage.update({ where: { id: params.id }, data });
    return NextResponse.json(overage);
  } catch { return NextResponse.json({ error: 'Failed' }, { status: 500 }); }
}
