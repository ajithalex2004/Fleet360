import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { legacyLeasingBillingWriteMoved } from '@/lib/finance-leasing-billing-routing';
export async function GET(req: NextRequest) {
  try {
    const { searchParams } = new URL(req.url);
    const lesseeId = searchParams.get('lesseeId');
    const dds = await prisma.leaseDirectDebit.findMany({
      where: lesseeId ? { lesseeId } : {},
      include: { lessee: { select: { name: true } } },
      orderBy: { createdAt: 'desc' },
    });
    return NextResponse.json(dds);
  } catch { return NextResponse.json({ error: 'Failed' }, { status: 500 }); }
}
export async function POST(req: NextRequest) {
  try {
    const moved = legacyLeasingBillingWriteMoved(req, '/api/finance/leasing-billing/direct-debits');
    if (moved) return moved;
    const body = await req.json();
    const count = await prisma.leaseDirectDebit.count();
    const mandateRef = body.mandateRef ?? `DD-${String(count + 1).padStart(6, '0')}`;
    const dd = await prisma.leaseDirectDebit.create({ data: { ...body, mandateRef } });
    return NextResponse.json(dd, { status: 201 });
  } catch { return NextResponse.json({ error: 'Failed' }, { status: 500 }); }
}
