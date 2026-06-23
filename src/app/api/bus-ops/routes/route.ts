import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import {
  attachTenantToEntity,
  ensureOperationalTenantColumn,
  recordOperationalChange,
  requireOperationalContext,
  tenantScopedIds,
} from '@/lib/cross-module-governance';

type RouteStopInput = {
  sequence?: number;
  stopName?: string;
  gpsLat?: number;
  gpsLng?: number;
  estimatedArrivalMins?: number;
  landmark?: string;
};

export async function GET(req: NextRequest) {
  try {
    const { searchParams } = new URL(req.url);
    const ctx = requireOperationalContext(req, 'bus_ops', { requestedTenantId: searchParams.get('tenantId') });
    if (ctx instanceof NextResponse) return ctx;
    await ensureOperationalTenantColumn('bus_routes');
    const active = searchParams.get('active');
    const ids = await tenantScopedIds('bus_routes', ctx.tenantId, { activeOnly: true });
    if (ids.length === 0) return NextResponse.json([]);
    const routes = await prisma.busRoute.findMany({
      where: {
        id: { in: ids },
        deletedAt: null,
        ...(active === 'true' ? { isActive: true } : {}),
      },
      include: { stops: { orderBy: { sequence: 'asc' } } },
      orderBy: { createdAt: 'desc' },
    });
    return NextResponse.json(routes);
  } catch (error) {
    console.error('Error fetching routes:', error);
    return NextResponse.json({ error: 'Failed to fetch routes' }, { status: 500 });
  }
}

export async function POST(req: NextRequest) {
  try {
    const ctx = requireOperationalContext(req, 'bus_ops', { write: true });
    if (ctx instanceof NextResponse) return ctx;
    await ensureOperationalTenantColumn('bus_routes');
    const body = await req.json();
    const { stops, ...routeData } = body;
    const route = await prisma.busRoute.create({
      data: {
        ...routeData,
        stops: stops?.length
          ? { create: (stops as RouteStopInput[]).map((s, i: number) => ({ ...s, sequence: s.sequence ?? i + 1 })) }
          : undefined,
      },
      include: { stops: { orderBy: { sequence: 'asc' } } },
    });
    await attachTenantToEntity('bus_routes', route.id, ctx.tenantId);
    await recordOperationalChange({
      req,
      ctx,
      entityType: 'BusRoute',
      entityId: route.id,
      action: 'CREATE',
      after: route,
      summary: `Created bus route ${route.name}`,
    });
    return NextResponse.json(route, { status: 201 });
  } catch (error) {
    console.error('Error creating route:', error);
    return NextResponse.json({ error: 'Failed to create route' }, { status: 500 });
  }
}
