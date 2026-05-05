import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
export async function PATCH(req: NextRequest, { params }: { params: { id: string } }) {
  try {
    const body = await req.json();
    const { originalContract, ...data } = body;
    if (data.status === 'ACCEPTED' && !data.customerResponseAt) data.customerResponseAt = new Date();
    const renewal = await prisma.leaseRenewal.update({ where: { id: params.id }, data: { ...data, updatedAt: new Date() } });
    return NextResponse.json(renewal);
  } catch (e) { return NextResponse.json({ error: 'Failed' }, { status: 500 }); }
}
