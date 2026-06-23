import { NextRequest, NextResponse } from 'next/server';
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
    await ensureOperationalTenantColumn('trip_passengers');
    const tripId = searchParams.get('tripId');
    const ids = await tenantScopedIds('trip_passengers', ctx.tenantId);
    if (ids.length === 0) return NextResponse.json([]);
    const passengers = await prisma.tripPassenger.findMany({
      where: { id: { in: ids }, ...(tripId ? { tripId } : {}) },
      include: { trip: { include: { route: true } } },
      orderBy: { createdAt: 'desc' },
    });
    return NextResponse.json(passengers);
  } catch (error) {
    console.error('Error fetching passengers:', error);
    return NextResponse.json({ error: 'Failed to fetch passengers' }, { status: 500 });
  }
}

export async function POST(req: NextRequest) {
  try {
    const ctx = requireOperationalContext(req, 'bus_ops', { write: true });
    if (ctx instanceof NextResponse) return ctx;
    await ensureOperationalTenantColumn('trip_passengers');
    const body = await req.json();
    if (!(await prisma.$queryRawUnsafe<Array<{ id: string }>>(
      `SELECT id::text AS id FROM trip_schedules WHERE id::text = $1 AND tenant_id::text = $2 AND deleted_at IS NULL LIMIT 1`,
      body.tripId,
      ctx.tenantId,
    )).length) {
      return NextResponse.json({ error: 'Trip not found for tenant' }, { status: 404 });
    }
    const passenger = await prisma.tripPassenger.create({
      data: body,
      include: { trip: true },
    });
    await attachTenantToEntity('trip_passengers', passenger.id, ctx.tenantId);
    // Increment trip confirmed count
    await prisma.tripSchedule.update({
      where: { id: body.tripId },
      data: { confirmedCount: { increment: 1 } },
    });
    await recordOperationalChange({
      req,
      ctx,
      entityType: 'TripPassenger',
      entityId: passenger.id,
      action: 'CREATE',
      after: passenger,
      summary: `Added passenger to bus trip ${body.tripId}`,
    });
    return NextResponse.json(passenger, { status: 201 });
  } catch (error) {
    console.error('Error creating passenger:', error);
    return NextResponse.json({ error: 'Failed to create passenger' }, { status: 500 });
  }
}
