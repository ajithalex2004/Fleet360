import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { cacheRead, privateCacheControl, revalidateCache } from '@/lib/server-cache';
import { expandRosterToTrip } from '@/lib/bus-ops/expand-roster';
import { resolveVariantVersionForTrip } from '@/lib/bus-ops/resolve-variant-version';
import { raiseAlert } from '@/lib/alerts/raise';

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

    // Route versioning Phase 1 — snapshot the exact variant version this
    // trip runs. Prefer explicit body.routeVariantVersionId, else derive
    // from routeVariantId, else from routeId+direction, else routeId
    // alone. Null result means the route has no variants yet — the trip
    // is written without a snapshot (Phase 1 back-compat) and Phase 2
    // reader migration will start requiring it.
    const snapshot = await resolveVariantVersionForTrip({
      tenantId,
      routeId:              body.routeId ?? null,
      direction:            body.direction ?? null,
      routeVariantId:       body.routeVariantId ?? null,
      routeVariantVersionId: body.routeVariantVersionId ?? null,
    }).catch(err => {
      console.warn('[schedules.POST] variant-version resolve failed:', err);
      return null;
    });

    const schedule = await prisma.tripSchedule.create({
      data: {
        ...body,
        tripNumber,
        tenantId,
        routeVariantVersionId: snapshot?.id ?? null,
      },
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

    // Alert Engine — CAPACITY_EXCEEDED. Roster expansion just wrote the
    // definitive attendance count; compare against the schedule's
    // capacity (which the caller sets or defaults from the route).
    // Dedup on scheduleId — only one CAPACITY_EXCEEDED per trip at a
    // time. Re-triggers after ops resolves the alert and a passenger is
    // added later.
    if (schedule.capacity && rosterExpansion) {
      const seated = (rosterExpansion.inserted ?? 0) + (rosterExpansion.skipped ?? 0);
      if (seated > schedule.capacity) {
        void raiseAlert({
          tenantId,
          code:         'CAPACITY_EXCEEDED',
          sourceModule: 'bus-ops',
          subjectType:  'TripSchedule',
          subjectId:    schedule.id,
          title:        `Trip ${schedule.tripNumber ?? schedule.id.slice(0, 8)} · over capacity (${seated}/${schedule.capacity})`,
          description:  `${seated - schedule.capacity} passenger${seated - schedule.capacity === 1 ? '' : 's'} above the bus's ${schedule.capacity}-seat capacity.`,
          severity:     'HIGH',
          context: {
            scheduleId:    schedule.id,
            tripNumber:    schedule.tripNumber,
            capacity:      schedule.capacity,
            confirmedCount: seated,
            overBy:        seated - schedule.capacity,
          },
        });
      }
    }

    revalidateCache([CACHE_TAG]);
    return NextResponse.json({ ...schedule, rosterExpansion }, { status: 201 });
  } catch (error) {
    console.error('Error creating schedule:', error);
    return NextResponse.json({ error: 'Failed to create schedule' }, { status: 500 });
  }
}
