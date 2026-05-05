import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
export async function PATCH(req: NextRequest, { params }: { params: { id: string } }) {
  try {
    const { contract, ...data } = await req.json();
    const overage = await prisma.leaseMileageOverage.update({ where: { id: params.id }, data });
    return NextResponse.json(overage);
  } catch (e) { return NextResponse.json({ error: 'Failed' }, { status: 500 }); }
}
