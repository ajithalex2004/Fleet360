import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
export async function PATCH(req: NextRequest, { params }: { params: { id: string } }) {
  try {
    const { lessee, ...data } = await req.json();
    const item = await prisma.leaseCreditAssessment.update({ where: { id: params.id }, data: { ...data, updatedAt: new Date() } });
    return NextResponse.json(item);
  } catch (e) { return NextResponse.json({ error: 'Failed' }, { status: 500 }); }
}
