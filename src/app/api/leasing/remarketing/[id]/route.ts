import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
export async function PATCH(req: NextRequest, { params }: { params: { id: string } }) {
  try {
    const body = await req.json();
    if (body.stage === 'SOLD' && !body.saleDate) body.saleDate = new Date();
    if (body.salePrice && body.bookValue) body.saleProfit = parseFloat(body.salePrice) - parseFloat(body.bookValue);
    const item = await prisma.leaseRemarketing.update({ where: { id: params.id }, data: { ...body, updatedAt: new Date() } });
    return NextResponse.json(item);
  } catch (e) { return NextResponse.json({ error: 'Failed' }, { status: 500 }); }
}
