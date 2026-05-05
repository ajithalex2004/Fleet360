import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';

export async function GET(req: NextRequest) {
  try {
    const { searchParams } = new URL(req.url);
    const scheduleId = searchParams.get('scheduleId');
    const logs = await prisma.tripLog.findMany({
      where: scheduleId ? { scheduleId } : {},
      include: { schedule: { include: { route: true } } },
      orderBy: { createdAt: 'desc' },
    });
    return NextResponse.json(logs);
  } catch (error) {
    return NextResponse.json({ error: 'Failed to fetch' }, { status: 500 });
  }
}

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const log = await prisma.tripLog.create({ data: body });
    return NextResponse.json(log, { status: 201 });
  } catch (error) {
    return NextResponse.json({ error: 'Failed to create' }, { status: 500 });
  }
}
