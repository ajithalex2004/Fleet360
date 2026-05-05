import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
export async function GET(req: NextRequest, { params }: { params: { id: string } }) {
  const p = await prisma.leaseInsurancePolicy.findUnique({ where: { id: params.id }, include: { claims: true } });
  return p ? NextResponse.json(p) : NextResponse.json({ error: 'Not found' }, { status: 404 });
}
export async function PATCH(req: NextRequest, { params }: { params: { id: string } }) {
  try {
    const { claims, ...data } = await req.json();
    const p = await prisma.leaseInsurancePolicy.update({ where: { id: params.id }, data: { ...data, updatedAt: new Date() } });
    return NextResponse.json(p);
  } catch (e) { return NextResponse.json({ error: 'Failed' }, { status: 500 }); }
}
export async function DELETE(req: NextRequest, { params }: { params: { id: string } }) {
  await prisma.leaseInsurancePolicy.update({ where: { id: params.id }, data: { deletedAt: new Date() } });
  return NextResponse.json({ success: true });
}
