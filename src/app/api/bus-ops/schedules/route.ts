import { NextRequest, NextResponse } from 'next/server';
import type { Prisma } from '@prisma/client';
import { prisma } from '@/lib/prisma';
import {
  attachTenantToEntity,
  ensureOperationalTenantColumn,
  recordOperationalChange,
  requireOperationalContext,
  tenantScopedIds,
} from '@/lib/cross-module-governance';

export async function GET(req: NextRequest) {
  try {
    const { searchParams } = new URL(req.url);
    const ctx = requireOperationalContext(req, 'bus_ops', { requestedTenantId: searchParams.get('tenantId') });
    if (ctx instanceof NextResponse) return ctx;
    await ensureOperationalTenantColumn('trip_schedules');
    const status = searchParams.get('status');
    const routeId = searchParams.get('routeId');
    const dateStr = searchParams.get('date');

    const ids = await tenantScopedIds('trip_schedules', ctx.tenantId, { activeOnly: true });
    if (ids.length === 0) return NextResponse.json([]);

    const where: Prisma.TripScheduleWhereInput = { id: { in: ids }, deletedAt: null };
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
    const ctx = requireOperationalContext(req, 'bus_ops', { write: true });
    if (ctx instanceof NextResponse) return ctx;
    await ensureOperationalTenantColumn('trip_schedules');
    const body = await req.json();
    if (body.routeId) {
      const routeRows = await prisma.$queryRawUnsafe<Array<{ id: string }>>(
        `SELECT id::text AS id FROM bus_routes WHERE id::text = $1 AND tenant_id::text = $2 AND deleted_at IS NULL LIMIT 1`,
        body.routeId,
        ctx.tenantId,
      );
      if (routeRows.length === 0) {
        return NextResponse.json({ error: 'Route not found for tenant' }, { status: 404 });
      }
    }
    const count = await prisma.tripSchedule.count();
    const tripNumber = body.tripNumber ?? `TRP-${String(count + 1).padStart(5, '0')}`;
    const schedule = await prisma.tripSchedule.create({
      data: { ...body, tripNumber },
      include: { route: true },
    });
    await attachTenantToEntity('trip_schedules', schedule.id, ctx.tenantId);
    await recordOperationalChange({
      req,
      ctx,
      entityType: 'BusTrip',
      entityId: schedule.id,
      action: 'CREATE',
      after: schedule,
      summary: `Created bus trip ${schedule.tripNumber ?? schedule.id}`,
    });
    return NextResponse.json(schedule, { status: 201 });
  } catch (error) {
    console.error('Error creating schedule:', error);
    return NextResponse.json({ error: 'Failed to create schedule' }, { status: 500 });
  }
}
