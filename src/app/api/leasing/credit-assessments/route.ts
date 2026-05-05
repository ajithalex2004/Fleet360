import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
export async function GET(req: NextRequest) {
  try {
    const { searchParams } = new URL(req.url);
    const lesseeId = searchParams.get('lesseeId');
    const items = await prisma.leaseCreditAssessment.findMany({
      where: lesseeId ? { lesseeId } : {},
      include: { lessee: { select: { name: true, type: true } } },
      orderBy: { assessmentDate: 'desc' },
    });
    return NextResponse.json(items);
  } catch (e) { return NextResponse.json({ error: 'Failed' }, { status: 500 }); }
}
export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const item = await prisma.leaseCreditAssessment.create({ data: body });
    return NextResponse.json(item, { status: 201 });
  } catch (e) { return NextResponse.json({ error: 'Failed' }, { status: 500 }); }
}
