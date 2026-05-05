import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
export async function GET(req: NextRequest, { params }: { params: { id: string } }) {
  const fine = await prisma.leaseTrafficFine.findUnique({ where: { id: params.id }, include: { contract: true } });
  return fine ? NextResponse.json(fine) : NextResponse.json({ error: 'Not found' }, { status: 404 });
}
export async function PATCH(req: NextRequest, { params }: { params: { id: string } }) {
  try {
    const body = await req.json();
    const { contract, ...data } = body;
    if (data.billingStatus === 'PAID' && !data.paidDate) data.paidDate = new Date();
    const fine = await prisma.leaseTrafficFine.update({ where: { id: params.id }, data: { ...data, updatedAt: new Date() } });
    return NextResponse.json(fine);
  } catch (e) { return NextResponse.json({ error: 'Failed' }, { status: 500 }); }
}
export async function DELETE(req: NextRequest, { params }: { params: { id: string } }) {
  await prisma.leaseTrafficFine.delete({ where: { id: params.id } });
  return NextResponse.json({ success: true });
}
