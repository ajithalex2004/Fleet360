import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import {
  ensureOperationalTenantColumn,
  recordOperationalChange,
  requireOperationalContext,
} from '@/lib/cross-module-governance';

type Params = { params: Promise<{ id: string }> };

async function busRouteBelongsToTenant(id: string, tenantId: string) {
  await ensureOperationalTenantColumn('bus_routes');
  const rows = await prisma.$queryRawUnsafe<Array<{ id: string }>>(
    `SELECT id::text AS id FROM bus_routes WHERE id::text = $1 AND tenant_id::text = $2 AND deleted_at IS NULL LIMIT 1`,
    id,
    tenantId,
  );
  return rows.length > 0;
}

export async function GET(req: NextRequest, { params }: Params) {
  try {
    const ctx = requireOperationalContext(req, 'bus_ops');
    if (ctx instanceof NextResponse) return ctx;
    const { id } = await params;
    if (!(await busRouteBelongsToTenant(id, ctx.tenantId))) {
      return NextResponse.json({ error: 'Not found' }, { status: 404 });
    }
    const route = await prisma.busRoute.findUnique({
      where: { id },
      include: {
        stops: { orderBy: { sequence: 'asc' } },
        schedules: {
          where: { deletedAt: null },
          orderBy: { departureTime: 'desc' },
          take: 10,
          include: { _count: { select: { passengers: true } } },
        },
      },
    });
    if (!route) return NextResponse.json({ error: 'Not found' }, { status: 404 });
    return NextResponse.json(route);
  } catch {
    return NextResponse.json({ error: 'Failed to fetch' }, { status: 500 });
  }
}

export async function PATCH(req: NextRequest, { params }: Params) {
  try {
    const ctx = requireOperationalContext(req, 'bus_ops', { write: true });
    if (ctx instanceof NextResponse) return ctx;
    const { id } = await params;
    if (!(await busRouteBelongsToTenant(id, ctx.tenantId))) {
      return NextResponse.json({ error: 'Not found' }, { status: 404 });
    }
    const body = await req.json();
    const before = await prisma.busRoute.findUnique({ where: { id } });
    const data = { ...body };
    delete data.stops;
    delete data.schedules;
    const route = await prisma.busRoute.update({
      where: { id },
      data: { ...data, updatedAt: new Date() },
      include: { stops: { orderBy: { sequence: 'asc' } } },
    });
    await recordOperationalChange({
      req,
      ctx,
      entityType: 'BusRoute',
      entityId: id,
      action: 'UPDATE',
      before,
      after: route,
      summary: `Updated bus route ${route.name}`,
    });
    return NextResponse.json(route);
  } catch {
    return NextResponse.json({ error: 'Failed to update' }, { status: 500 });
  }
}

export async function DELETE(req: NextRequest, { params }: Params) {
  try {
    const ctx = requireOperationalContext(req, 'bus_ops', { write: true });
    if (ctx instanceof NextResponse) return ctx;
    const { id } = await params;
    if (!(await busRouteBelongsToTenant(id, ctx.tenantId))) {
      return NextResponse.json({ error: 'Not found' }, { status: 404 });
    }
    const before = await prisma.busRoute.findUnique({ where: { id } });
    const route = await prisma.busRoute.update({
      where: { id },
      data: { deletedAt: new Date(), isActive: false },
    });
    await recordOperationalChange({
      req,
      ctx,
      entityType: 'BusRoute',
      entityId: id,
      action: 'DELETE',
      before,
      after: route,
      summary: `Deleted bus route ${route.name}`,
    });
    return NextResponse.json({ success: true });
  } catch {
    return NextResponse.json({ error: 'Failed to delete' }, { status: 500 });
  }
}
