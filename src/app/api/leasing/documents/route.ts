import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
export async function GET(req: NextRequest) {
  try {
    const { searchParams } = new URL(req.url);
    const entityType = searchParams.get('entityType');
    const entityId   = searchParams.get('entityId');
    const docs = await prisma.leaseDocument.findMany({
      where: {
        ...(entityType ? { entityType } : {}),
        ...(entityId   ? { entityId   } : {}),
      },
      orderBy: { createdAt: 'desc' },
    });
    return NextResponse.json(docs);
  } catch (e) { return NextResponse.json({ error: 'Failed' }, { status: 500 }); }
}
export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const doc = await prisma.leaseDocument.create({ data: body });
    return NextResponse.json(doc, { status: 201 });
  } catch (e) { return NextResponse.json({ error: 'Failed' }, { status: 500 }); }
}
