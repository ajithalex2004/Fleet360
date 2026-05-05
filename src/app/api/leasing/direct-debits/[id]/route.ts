import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
export async function PATCH(req: NextRequest, { params }: { params: { id: string } }) {
  try {
    const { lessee, ...data } = await req.json();
    if (data.status === 'ACTIVE' && !data.activatedAt) data.activatedAt = new Date();
    const dd = await prisma.leaseDirectDebit.update({ where: { id: params.id }, data: { ...data, updatedAt: new Date() } });
    return NextResponse.json(dd);
  } catch (e) { return NextResponse.json({ error: 'Failed' }, { status: 500 }); }
}
export async function DELETE(req: NextRequest, { params }: { params: { id: string } }) {
  await prisma.leaseDirectDebit.delete({ where: { id: params.id } });
  return NextResponse.json({ success: true });
}
