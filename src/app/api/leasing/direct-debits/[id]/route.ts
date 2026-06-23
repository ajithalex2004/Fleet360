import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { legacyLeasingBillingWriteMoved } from '@/lib/finance-leasing-billing-routing';
export async function PATCH(req: NextRequest, { params }: { params: { id: string } }) {
  try {
    const moved = legacyLeasingBillingWriteMoved(req, `/api/finance/leasing-billing/direct-debits/${params.id}`);
    if (moved) return moved;
    const { lessee: _ignoredLessee, ...data } = await req.json();
    void _ignoredLessee;
    if (data.status === 'ACTIVE' && !data.activatedAt) data.activatedAt = new Date();
    const dd = await prisma.leaseDirectDebit.update({ where: { id: params.id }, data: { ...data, updatedAt: new Date() } });
    return NextResponse.json(dd);
  } catch { return NextResponse.json({ error: 'Failed' }, { status: 500 }); }
}
export async function DELETE(req: NextRequest, { params }: { params: { id: string } }) {
  const moved = legacyLeasingBillingWriteMoved(req, `/api/finance/leasing-billing/direct-debits/${params.id}`);
  if (moved) return moved;
  await prisma.leaseDirectDebit.delete({ where: { id: params.id } });
  return NextResponse.json({ success: true });
}
