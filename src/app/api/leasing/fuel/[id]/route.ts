import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
export async function PATCH(req: NextRequest, { params }: { params: { id: string } }) {
  try {
    const body = await req.json();
    const { contract, ...data } = body;
    const log = await prisma.leaseFuelLog.update({ where: { id: params.id }, data });
    return NextResponse.json(log);
  } catch (e) { return NextResponse.json({ error: 'Failed' }, { status: 500 }); }
}
export async function DELETE(req: NextRequest, { params }: { params: { id: string } }) {
  await prisma.leaseFuelLog.delete({ where: { id: params.id } });
  return NextResponse.json({ success: true });
}
