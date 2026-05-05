import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
export async function GET(req: NextRequest) {
  try {
    const { searchParams } = new URL(req.url);
    const lesseeId = searchParams.get('lesseeId');
    const dds = await prisma.leaseDirectDebit.findMany({
      where: lesseeId ? { lesseeId } : {},
      include: { lessee: { select: { name: true } } },
      orderBy: { createdAt: 'desc' },
    });
    return NextResponse.json(dds);
  } catch (e) { return NextResponse.json({ error: 'Failed' }, { status: 500 }); }
}
export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const count = await prisma.leaseDirectDebit.count();
    const mandateRef = body.mandateRef ?? `DD-${String(count + 1).padStart(6, '0')}`;
    const dd = await prisma.leaseDirectDebit.create({ data: { ...body, mandateRef } });
    return NextResponse.json(dd, { status: 201 });
  } catch (e) { return NextResponse.json({ error: 'Failed' }, { status: 500 }); }
}
