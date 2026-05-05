import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
export async function GET(req: NextRequest) {
  try {
    const { searchParams } = new URL(req.url);
    const contractId = searchParams.get('contractId');
    const billingStatus = searchParams.get('billingStatus');
    const logs = await prisma.leaseFuelLog.findMany({
      where: { ...(contractId ? { contractId } : {}), ...(billingStatus ? { billingStatus } : {}) },
      include: { contract: { select: { contractNumber: true } } },
      orderBy: { fuelDate: 'desc' },
    });
    return NextResponse.json(logs);
  } catch (e) { return NextResponse.json({ error: 'Failed' }, { status: 500 }); }
}
export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const totalCost = body.totalCost ?? (parseFloat(body.liters) * parseFloat(body.costPerLiter || '0'));
    const log = await prisma.leaseFuelLog.create({ data: { ...body, totalCost } });
    return NextResponse.json(log, { status: 201 });
  } catch (e) { return NextResponse.json({ error: 'Failed' }, { status: 500 }); }
}
