import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';

export async function GET(req: NextRequest) {
  try {
    const { searchParams } = new URL(req.url);
    const status = searchParams.get('status');
    const requests = await prisma.staffTransportRequest.findMany({
      where: status ? { status } : {},
      include: { staffMember: true },
      orderBy: { createdAt: 'desc' },
    });
    return NextResponse.json(requests);
  } catch (error) {
    return NextResponse.json({ error: 'Failed to fetch' }, { status: 500 });
  }
}

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const count = await prisma.staffTransportRequest.count();
    const requestNo = body.requestNo ?? `REQ-${String(count + 1).padStart(5, '0')}`;
    const request = await prisma.staffTransportRequest.create({
      data: { ...body, requestNo },
      include: { staffMember: true },
    });
    return NextResponse.json(request, { status: 201 });
  } catch (error) {
    return NextResponse.json({ error: 'Failed to create' }, { status: 500 });
  }
}
