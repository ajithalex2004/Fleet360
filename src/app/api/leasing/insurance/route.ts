import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
export async function GET(req: NextRequest) {
  try {
    const { searchParams } = new URL(req.url);
    const contractId = searchParams.get('contractId');
    const status     = searchParams.get('status');
    const now = new Date();
    // Auto-update expiring soon status
    const policies = await prisma.leaseInsurancePolicy.findMany({
      where: {
        deletedAt: null,
        ...(contractId ? { contractId } : {}),
        ...(status ? { status } : {}),
      },
      include: { claims: { orderBy: { createdAt: 'desc' }, take: 3 } },
      orderBy: { expiryDate: 'asc' },
    });
    // Flag expiring policies (within 30 days)
    const result = policies.map(p => ({
      ...p,
      daysToExpiry: Math.ceil((new Date(p.expiryDate).getTime() - now.getTime()) / 86400000),
    }));
    return NextResponse.json(result);
  } catch (e) { return NextResponse.json({ error: 'Failed' }, { status: 500 }); }
}
export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const count = await prisma.leaseInsurancePolicy.count();
    const policyNo = body.policyNo ?? `INS-${String(count + 1).padStart(5, '0')}`;
    const policy = await prisma.leaseInsurancePolicy.create({ data: { ...body, policyNo } });
    return NextResponse.json(policy, { status: 201 });
  } catch (e) { return NextResponse.json({ error: 'Failed' }, { status: 500 }); }
}
