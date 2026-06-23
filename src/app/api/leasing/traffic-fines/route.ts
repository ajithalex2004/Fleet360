import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { legacyLeasingBillingWriteMoved } from '@/lib/finance-leasing-billing-routing';
export async function GET(req: NextRequest) {
  try {
    const { searchParams } = new URL(req.url);
    const contractId = searchParams.get('contractId');
    const billingStatus = searchParams.get('billingStatus');
    const fines = await prisma.leaseTrafficFine.findMany({
      where: { ...(contractId ? { contractId } : {}), ...(billingStatus ? { billingStatus } : {}) },
      include: { contract: { select: { contractNumber: true } } },
      orderBy: { violationDate: 'desc' },
    });
    return NextResponse.json(fines);
  } catch { return NextResponse.json({ error: 'Failed' }, { status: 500 }); }
}
export async function POST(req: NextRequest) {
  try {
    const moved = legacyLeasingBillingWriteMoved(req, '/api/finance/leasing-billing/traffic-fines');
    if (moved) return moved;
    const body = await req.json();
    const count = await prisma.leaseTrafficFine.count();
    const fineNo = body.fineNo ?? `TF-${String(count + 1).padStart(6, '0')}`;
    const finalAmount = body.finalAmount ?? (parseFloat(body.fineAmount) - parseFloat(body.discountAmount || '0'));
    const fine = await prisma.leaseTrafficFine.create({ data: { ...body, fineNo, finalAmount } });
    return NextResponse.json(fine, { status: 201 });
  } catch { return NextResponse.json({ error: 'Failed' }, { status: 500 }); }
}
