import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
export async function GET(req: NextRequest, { params }: { params: { id: string } }) {
  const item = await prisma.leaseEarlyTermination.findUnique({ where: { id: params.id }, include: { contract: true } });
  return item ? NextResponse.json(item) : NextResponse.json({ error: 'Not found' }, { status: 404 });
}
export async function PATCH(req: NextRequest, { params }: { params: { id: string } }) {
  try {
    const body = await req.json();
    const { contract, ...data } = body;
    if (data.status === 'APPROVED' && !data.approvedAt) data.approvedAt = new Date();
    const item = await prisma.leaseEarlyTermination.update({ where: { id: params.id }, data: { ...data, updatedAt: new Date() } });
    // If executed, update contract status
    if (data.status === 'EXECUTED') {
      await prisma.leaseContract2.update({ where: { id: item.contractId }, data: { status: 'TERMINATED' } });
    }
    return NextResponse.json(item);
  } catch (e) { return NextResponse.json({ error: 'Failed' }, { status: 500 }); }
}
