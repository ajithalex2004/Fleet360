import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
export async function PATCH(req: NextRequest, { params }: { params: { id: string } }) {
  try {
    const body = await req.json();
    const doc = await prisma.leaseDocument.update({ where: { id: params.id }, data: { ...body, updatedAt: new Date() } });
    return NextResponse.json(doc);
  } catch (e) { return NextResponse.json({ error: 'Failed' }, { status: 500 }); }
}
export async function DELETE(req: NextRequest, { params }: { params: { id: string } }) {
  await prisma.leaseDocument.delete({ where: { id: params.id } });
  return NextResponse.json({ success: true });
}
