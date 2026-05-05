import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
export async function GET(req: NextRequest) {
  try {
    const { searchParams } = new URL(req.url);
    const stage = searchParams.get('stage');
    const items = await prisma.leaseRemarketing.findMany({
      where: stage ? { stage } : {},
      orderBy: { createdAt: 'desc' },
    });
    return NextResponse.json(items);
  } catch (e) { return NextResponse.json({ error: 'Failed' }, { status: 500 }); }
}
export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const count = await prisma.leaseRemarketing.count();
    const remarketingNo = `RMK-${String(count + 1).padStart(5, '0')}`;
    const item = await prisma.leaseRemarketing.create({ data: { ...body, remarketingNo } });
    return NextResponse.json(item, { status: 201 });
  } catch (e) { return NextResponse.json({ error: 'Failed' }, { status: 500 }); }
}
