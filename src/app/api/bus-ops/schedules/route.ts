import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';

export async function GET(req: NextRequest) {
  try {
    const { searchParams } = new URL(req.url);
    const status = searchParams.get('status');
    const routeId = searchParams.get('routeId');
    const dateStr = searchParams.get('date');

    const where: any = { deletedAt: null };
    if (status) where.status = status;
    if (routeId) where.routeId = routeId;
    if (dateStr) {
      const start = new Date(dateStr); start.setHours(0,0,0,0);
      const end   = new Date(dateStr); end.setHours(23,59,59,999);
      where.departureTime = { gte: start, lte: end };
    }

    const schedules = await prisma.tripSchedule.findMany({
      where,
      include: {
        route: true,
        passengers: true,
        tripLogs: { orderBy: { createdAt: 'desc' }, take: 1 },
      },
      orderBy: { departureTime: 'asc' },
    });
    return NextResponse.json(schedules);
  } catch (error) {
    console.error('Error fetching schedules:', error);
    return NextResponse.json({ error: 'Failed to fetch schedules' }, { status: 500 });
  }
}

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const count = await prisma.tripSchedule.count();
    const tripNumber = body.tripNumber ?? `TRP-${String(count + 1).padStart(5, '0')}`;
    const schedule = await prisma.tripSchedule.create({
      data: { ...body, tripNumber },
      include: { route: true },
    });
    return NextResponse.json(schedule, { status: 201 });
  } catch (error) {
    console.error('Error creating schedule:', error);
    return NextResponse.json({ error: 'Failed to create schedule' }, { status: 500 });
  }
}
