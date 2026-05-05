import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
export async function GET(req: NextRequest, { params }: { params: { id: string } }) {
  const claims = await prisma.leaseInsuranceClaim.findMany({ where: { policyId: params.id }, orderBy: { createdAt: 'desc' } });
  return NextResponse.json(claims);
}
export async function POST(req: NextRequest, { params }: { params: { id: string } }) {
  try {
    const body = await req.json();
    const count = await prisma.leaseInsuranceClaim.count();
    const claimNo = `CLM-${String(count + 1).padStart(5, '0')}`;
    const claim = await prisma.leaseInsuranceClaim.create({ data: { ...body, policyId: params.id, claimNo } });
    return NextResponse.json(claim, { status: 201 });
  } catch (e) { return NextResponse.json({ error: 'Failed' }, { status: 500 }); }
}
