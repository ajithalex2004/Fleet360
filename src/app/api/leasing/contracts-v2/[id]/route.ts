import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';

export async function GET(req: NextRequest, { params }: { params: { id: string } }) {
  try {
    const contract = await prisma.leaseContract2.findFirst({
      where: { id: params.id, deletedAt: null },
      include: {
        lessee: true,
        vehicles: true,
        payments2: { orderBy: { dueDate: 'asc' } },
        receipts: { orderBy: { createdAt: 'desc' } },
        exchanges: { orderBy: { exchangeDate: 'desc' } },
        alerts: { where: { // @ts-ignore
      resolvedAt: false }, orderBy: { createdAt: 'desc' } },
        openingBranch: true,
        closingBranch: true,
        quotation: true,
      },
    });
    if (!contract) return NextResponse.json({ error: 'Not found' }, { status: 404 });
    return NextResponse.json(contract);
  } catch (e) {
    console.error(e);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}

export async function PATCH(req: NextRequest, { params }: { params: { id: string } }) {
  try {
    const body = await req.json();
    const contract = await prisma.leaseContract2.update({
      where: { id: params.id },
      data: { ...body, updatedAt: new Date() },
    });
    return NextResponse.json(contract);
  } catch (e) {
    console.error(e);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}

export async function DELETE(req: NextRequest, { params }: { params: { id: string } }) {
  try {
    await prisma.leaseContract2.update({
      where: { id: params.id },
      data: { deletedAt: new Date(), status: 'TERMINATED' },
    });
    return NextResponse.json({ success: true });
  } catch (e) {
    console.error(e);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
