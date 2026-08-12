import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { cacheRead, privateCacheControl, revalidateCache } from '@/lib/server-cache';
import { expandRosterToTrip } from '@/lib/bus-ops/expand-roster';

const CACHE_TAG = 'bus-ops:schedules';

const getSchedules = cacheRead(
  async (
    tenantId: string,
    status: string | null,
    routeId: string | null,
    dateStr: string | null,
  ) => {
    const where: any = { deletedAt: null, tenantId };
    if (status)   where.status   = status;
    if (routeId)  where.routeId  = routeId;
    if (dateStr) {
      const start = new Date(dateStr); start.setHours(0,0,0,0);
      const end   = new Date(dateStr); end.setHours(23,59,59,999);
      where.departureTime = { gte: start, lte: end };
    }
    return prisma.tripSchedule.findMany({
      where,
      include: {
        route: true,
        passengers: true,
        tripLogs: { orderBy: { createdAt: 'desc' }, take: 1 },
      },
      orderBy: { departureTime: 'asc' },
    });
  },
  [CACHE_TAG],
  30,
);

export async function GET(req: NextRequest) {
  try {
    const tenantId = req.headers.get('x-tenant-id');
    if (!tenantId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    const { searchParams } = new URL(req.url);
    const status  = searchParams.get('status');
    const routeId = searchParams.get('routeId');
    const dateStr = searchParams.get('date');

    const schedules = await getSchedules(tenantId, status, routeId, dateStr);
    return NextResponse.json(schedules, {
      headers: { 'Cache-Control': privateCacheControl(30, 120) },
    });
  } catch (error) {
    console.error('Error fetching schedules:', error);
    return NextResponse.json({ error: 'Failed to fetch schedules' }, { status: 500 });
  }
}

export async function POST(req: NextRequest) {
  try {
    const tenantId = req.headers.get('x-tenant-id');
    if (!tenantId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    const body = await req.json();
    const count = await prisma.tripSchedule.count();
    const tripNumber = body.tripNumber ?? `TRP-${String(count + 1).padStart(5, '0')}`;
    const schedule = await prisma.tripSchedule.create({
      data: { ...body, tripNumber, tenantId },
      include: { route: true },
    });

    // Materialise the route's standing passenger roster into TripPassenger
    // rows for this new trip. Best-effort: if the expansion fails for any
    // reason, the trip itself is already created and ops can re-run the
    // expansion manually via POST /api/bus-ops/schedules/[id]/expand-roster.
    let rosterExpansion = null;
    if (schedule.routeId && schedule.departureTime) {
      try {
        rosterExpansion = await expandRosterToTrip(
          tenantId,
          schedule.id,
          schedule.routeId,
          new Date(schedule.departureTime),
        );
      } catch (err) {
        console.error('[schedules.POST] roster expansion failed:', err);
      }
    }

    revalidateCache([CACHE_TAG]);
    return NextResponse.json({ ...schedule, rosterExpansion }, { status: 201 });
  } catch (error) {
    console.error('Error creating schedule:', error);
    return NextResponse.json({ error: 'Failed to create schedule' }, { status: 500 });
  }
}
