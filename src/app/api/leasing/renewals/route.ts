import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
export async function GET(req: NextRequest) {
  try {
    const { searchParams } = new URL(req.url);
    const status = searchParams.get('status');
    const renewals = await prisma.leaseRenewal.findMany({
      where: status ? { status } : {},
      include: { originalContract: { select: { contractNumber: true, endDate: true, monthlyRate: true } } },
      orderBy: { createdAt: 'desc' },
    });
    return NextResponse.json(renewals);
  } catch (e) { return NextResponse.json({ error: 'Failed' }, { status: 500 }); }
}
export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const count = await prisma.leaseRenewal.count();
    const renewalNo = `RNW-${String(count + 1).padStart(5, '0')}`;
    const renewal = await prisma.leaseRenewal.create({ data: { ...body, renewalNo } });
    return NextResponse.json(renewal, { status: 201 });
  } catch (e) { return NextResponse.json({ error: 'Failed' }, { status: 500 }); }
}
