import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
export async function GET(req: NextRequest) {
  try {
    const { searchParams } = new URL(req.url);
    const contractId = searchParams.get('contractId');
    const items = await prisma.leaseEarlyTermination.findMany({
      where: contractId ? { contractId } : {},
      include: { contract: { select: { contractNumber: true, monthlyRate: true, endDate: true } } },
      orderBy: { createdAt: 'desc' },
    });
    return NextResponse.json(items);
  } catch (e) { return NextResponse.json({ error: 'Failed' }, { status: 500 }); }
}
export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const count = await prisma.leaseEarlyTermination.count();
    const terminationNo = `ET-${String(count + 1).padStart(5, '0')}`;
    // Auto-calculate penalty and settlement
    const penaltyPct = parseFloat(body.penaltyPct || '20');
    const monthlyRate = parseFloat(body.monthlyRate || '0');
    const remainingMonths = parseInt(body.remainingMonths || '0');
    const penaltyAmount = (penaltyPct / 100) * monthlyRate * remainingMonths;
    const outstanding = parseFloat(body.outstandingPayments || '0');
    const depositRefund = parseFloat(body.depositRefund || '0');
    const totalSettlement = penaltyAmount + outstanding - depositRefund;
    const et = await prisma.leaseEarlyTermination.create({
      data: { ...body, terminationNo, penaltyAmount, totalSettlement },
    });
    return NextResponse.json(et, { status: 201 });
  } catch (e) { return NextResponse.json({ error: 'Failed' }, { status: 500 }); }
}
