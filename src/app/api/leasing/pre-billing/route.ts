import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
export async function GET(req: NextRequest) {
  try {
    const { searchParams } = new URL(req.url);
    const contractId = searchParams.get('contractId');
    const status     = searchParams.get('status');
    const stmts = await prisma.leasePreBillingStatement.findMany({
      where: { ...(contractId ? { contractId } : {}), ...(status ? { status } : {}) },
      include: { contract: { select: { contractNumber: true } } },
      orderBy: { createdAt: 'desc' },
    });
    return NextResponse.json(stmts);
  } catch (e) { return NextResponse.json({ error: 'Failed' }, { status: 500 }); }
}
export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const count = await prisma.leasePreBillingStatement.count();
    const statementNo = `PBS-${String(count + 1).padStart(5, '0')}`;
    // Auto-calc VAT (5%) and total
    const baseFields = ['baseRent','fuelCharges','fineCharges','maintenanceCharges','overageCharges','otherCharges'];
    const sub = baseFields.reduce((s, k) => s + parseFloat(body[k] || '0'), 0);
    const vatAmount = sub * 0.05;
    const totalAmount = sub + vatAmount;
    const stmt = await prisma.leasePreBillingStatement.create({
      data: { ...body, statementNo, vatAmount, totalAmount },
    });
    return NextResponse.json(stmt, { status: 201 });
  } catch (e) { return NextResponse.json({ error: 'Failed' }, { status: 500 }); }
}
