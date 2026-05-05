import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
export async function GET(req: NextRequest, { params }: { params: { id: string } }) {
  const inv = await prisma.leaseInvoice.findUnique({ where: { id: params.id }, include: { lines: true, lessee: true } });
  return inv ? NextResponse.json(inv) : NextResponse.json({ error: 'Not found' }, { status: 404 });
}
export async function PATCH(req: NextRequest, { params }: { params: { id: string } }) {
  try {
    const { lines, lessee, ...data } = await req.json();
    if (data.status === 'SENT'  && !data.sentAt)  data.sentAt  = new Date();
    if (data.status === 'PAID'  && !data.paidAt)  data.paidAt  = new Date();
    const inv = await prisma.leaseInvoice.update({ where: { id: params.id }, data: { ...data, updatedAt: new Date() } });
    return NextResponse.json(inv);
  } catch (e) { return NextResponse.json({ error: 'Failed' }, { status: 500 }); }
}
