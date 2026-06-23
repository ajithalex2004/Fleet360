import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { legacyLeasingBillingWriteMoved } from '@/lib/finance-leasing-billing-routing';

export async function GET(req: NextRequest) {
  try {
    const { searchParams } = new URL(req.url);
    const contractId = searchParams.get('contractId');

    const receipts = await prisma.leaseReceipt.findMany({
      where: { ...(contractId ? { contractId } : {}) },
      include: { contract: { select: { contractNumber: true } } },
      orderBy: { receivedDate: 'desc' },
    });
    return NextResponse.json(receipts);
  } catch (e) {
    console.error(e);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}

export async function POST(req: NextRequest) {
  try {
    const moved = legacyLeasingBillingWriteMoved(req, '/api/finance/leasing-billing/receipts');
    if (moved) return moved;
    const body = await req.json();
    const receiptNumber = `RCP-${Date.now().toString().slice(-6)}`;
    const amount = Number(body.amount ?? 0);

    const receipt = await prisma.leaseReceipt.create({
      data: {
        contractId: body.contractId,
        receiptNumber,
        paymentType: body.paymentType ?? 'MONTHLY',
        amount,
        currency: body.currency ?? 'AED',
        receivedDate: body.receivedDate ? new Date(body.receivedDate) : new Date(),
        paymentMethod: body.paymentMethod ?? null,
        chequeNo: body.chequeNo ?? null,
        bankRef: body.bankRef ?? null,
        receivedBy: body.receivedBy ?? null,
        branchId: body.branchId ?? null,
        notes: body.notes ?? null,
      },
    });
    return NextResponse.json(receipt, { status: 201 });
  } catch (e) {
    console.error(e);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
