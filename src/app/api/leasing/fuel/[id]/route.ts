import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { legacyLeasingBillingWriteMoved } from '@/lib/finance-leasing-billing-routing';
export async function PATCH(req: NextRequest, { params }: { params: { id: string } }) {
  try {
    const moved = legacyLeasingBillingWriteMoved(req, `/api/finance/leasing-billing/fuel/${params.id}`);
    if (moved) return moved;
    const body = await req.json();
    const { contract: _ignoredContract, ...data } = body;
    void _ignoredContract;
    const log = await prisma.leaseFuelLog.update({ where: { id: params.id }, data });
    return NextResponse.json(log);
  } catch { return NextResponse.json({ error: 'Failed' }, { status: 500 }); }
}
export async function DELETE(req: NextRequest, { params }: { params: { id: string } }) {
  const moved = legacyLeasingBillingWriteMoved(req, `/api/finance/leasing-billing/fuel/${params.id}`);
  if (moved) return moved;
  await prisma.leaseFuelLog.delete({ where: { id: params.id } });
  return NextResponse.json({ success: true });
}
