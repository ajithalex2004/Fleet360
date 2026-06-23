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
    await ensureOperationalTenantColumn('trip_logs');
    const scheduleId = searchParams.get('scheduleId');
    const ids = await tenantScopedIds('trip_logs', ctx.tenantId);
    if (ids.length === 0) return NextResponse.json([]);
    const logs = await prisma.tripLog.findMany({
      where: { id: { in: ids }, ...(scheduleId ? { scheduleId } : {}) },
      include: { schedule: { include: { route: true } } },
      orderBy: { createdAt: 'desc' },
    });
    return NextResponse.json(logs);
  } catch {
    return NextResponse.json({ error: 'Failed to fetch' }, { status: 500 });
  }
}

export async function POST(req: NextRequest) {
  try {
    const ctx = requireOperationalContext(req, 'bus_ops', { write: true });
    if (ctx instanceof NextResponse) return ctx;
    await ensureOperationalTenantColumn('trip_logs');
    const body = await req.json();
    if (!(await prisma.$queryRawUnsafe<Array<{ id: string }>>(
      `SELECT id::text AS id FROM trip_schedules WHERE id::text = $1 AND tenant_id::text = $2 AND deleted_at IS NULL LIMIT 1`,
      body.scheduleId,
      ctx.tenantId,
    )).length) {
      return NextResponse.json({ error: 'Trip not found for tenant' }, { status: 404 });
    }
    const log = await prisma.tripLog.create({ data: body });
    await attachTenantToEntity('trip_logs', log.id, ctx.tenantId);
    await recordOperationalChange({
      req,
      ctx,
      entityType: 'TripLog',
      entityId: log.id,
      action: 'CREATE',
      after: log,
      summary: `Created trip log for ${body.scheduleId}`,
    });
    return NextResponse.json(log, { status: 201 });
  } catch {
    return NextResponse.json({ error: 'Failed to create' }, { status: 500 });
  }
}
