import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
export async function GET(req: NextRequest) {
  try {
    const { searchParams } = new URL(req.url);
    const contractId = searchParams.get('contractId');
    const status     = searchParams.get('status');
    const overages = await prisma.leaseMileageOverage.findMany({
      where: { ...(contractId ? { contractId } : {}), ...(status ? { status } : {}) },
      include: { contract: { select: { contractNumber: true } } },
      orderBy: { createdAt: 'desc' },
    });
    return NextResponse.json(overages);
  } catch (e) { return NextResponse.json({ error: 'Failed' }, { status: 500 }); }
}
