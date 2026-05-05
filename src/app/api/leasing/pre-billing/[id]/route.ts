import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
export async function PATCH(req: NextRequest, { params }: { params: { id: string } }) {
  try {
    const body = await req.json();
    const { contract, ...data } = body;
    if (data.status === 'SENT' && !data.sentAt) data.sentAt = new Date();
    if (data.status === 'CONFIRMED' && !data.confirmedAt) data.confirmedAt = new Date();
    const stmt = await prisma.leasePreBillingStatement.update({ where: { id: params.id }, data });
    return NextResponse.json(stmt);
  } catch (e) { return NextResponse.json({ error: 'Failed' }, { status: 500 }); }
}
