import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';

export async function GET(req: NextRequest, { params }: { params: { id: string } }) {
  try {
    const receipts = await prisma.leaseReceipt.findMany({
      where: { contractId: params.id },
      orderBy: { receivedDate: 'desc' },
    });
    return NextResponse.json(receipts);
  } catch (e) {
    console.error(e);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}

export async function POST(req: NextRequest, { params }: { params: { id: string } }) {
  try {
    const body = await req.json();
    const receiptNumber = `RCP-${Date.now().toString().slice(-6)}`;
    const amount = Number(body.amount ?? 0);

    const receipt = await prisma.leaseReceipt.create({
      data: {
        contractId: params.id,
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
