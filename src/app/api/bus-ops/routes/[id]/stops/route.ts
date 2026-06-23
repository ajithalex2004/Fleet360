import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { entityBelongsToTenant, recordOperationalChange, requireOperationalContext } from '@/lib/cross-module-governance';

type Params = { params: Promise<{ id: string }> };
type StopInput = {
  stopName: string;
  sequence?: number;
  gpsLat?: number | null;
  gpsLng?: number | null;
  estimatedArrivalMins?: number | null;
  landmark?: string | null;
};

export async function GET(req: NextRequest, { params }: Params) {
  try {
    const ctx = requireOperationalContext(req, 'bus_ops');
    if (ctx instanceof NextResponse) return ctx;
    const { id } = await params;
    if (!(await entityBelongsToTenant('bus_routes', id, ctx.tenantId, { activeOnly: true }))) {
      return NextResponse.json({ error: 'Route not found' }, { status: 404 });
    }
    const stops = await prisma.routeStop.findMany({
      where: { routeId: id },
      orderBy: { sequence: 'asc' },
    });
    return NextResponse.json(stops);
  } catch {
    return NextResponse.json({ error: 'Failed to fetch' }, { status: 500 });
  }
}

// Replace all stops for a route (reorder/rebuild)
export async function PUT(req: NextRequest, { params }: Params) {
  try {
    const ctx = requireOperationalContext(req, 'bus_ops', { write: true });
    if (ctx instanceof NextResponse) return ctx;
    const { id } = await params;
    if (!(await entityBelongsToTenant('bus_routes', id, ctx.tenantId, { activeOnly: true }))) {
      return NextResponse.json({ error: 'Route not found' }, { status: 404 });
    }
    const body = await req.json();
    const stops = (body.stops ?? body) as StopInput[];
    const before = await prisma.routeStop.findMany({ where: { routeId: id }, orderBy: { sequence: 'asc' } });
    await prisma.$transaction([
      prisma.routeStop.deleteMany({ where: { routeId: id } }),
      prisma.routeStop.createMany({
        data: stops.map((s, i: number) => ({
          routeId: id,
          stopName: s.stopName,
          sequence: s.sequence ?? i + 1,
          gpsLat: s.gpsLat ?? null,
          gpsLng: s.gpsLng ?? null,
          estimatedArrivalMins: s.estimatedArrivalMins ?? null,
          landmark: s.landmark ?? null,
        })),
      }),
    ]);
    const newStops = await prisma.routeStop.findMany({
      where: { routeId: id },
      orderBy: { sequence: 'asc' },
    });
    await recordOperationalChange({
      req,
      ctx,
      entityType: 'RouteStop',
      entityId: id,
      action: 'UPDATE',
      before,
      after: newStops,
      summary: `Replaced stops for route ${id}`,
    });
    return NextResponse.json(newStops);
  } catch {
    return NextResponse.json({ error: 'Failed to update stops' }, { status: 500 });
  }
}

export async function POST(req: NextRequest, { params }: Params) {
  try {
    const ctx = requireOperationalContext(req, 'bus_ops', { write: true });
    if (ctx instanceof NextResponse) return ctx;
    const { id } = await params;
    if (!(await entityBelongsToTenant('bus_routes', id, ctx.tenantId, { activeOnly: true }))) {
      return NextResponse.json({ error: 'Route not found' }, { status: 404 });
    }
    const body = await req.json();
    const maxSeq = await prisma.routeStop.aggregate({
      where: { routeId: id },
      _max: { sequence: true },
    });
    const stop = await prisma.routeStop.create({
      data: {
        routeId: id,
        stopName: body.stopName,
        sequence: body.sequence ?? (maxSeq._max.sequence ?? 0) + 1,
        gpsLat: body.gpsLat ?? null,
        gpsLng: body.gpsLng ?? null,
        estimatedArrivalMins: body.estimatedArrivalMins ?? null,
        landmark: body.landmark ?? null,
      },
    });
    await recordOperationalChange({
      req,
      ctx,
      entityType: 'RouteStop',
      entityId: stop.id,
      action: 'CREATE',
      after: stop,
      summary: `Added stop ${stop.stopName} to route ${id}`,
    });
    return NextResponse.json(stop, { status: 201 });
  } catch {
    return NextResponse.json({ error: 'Failed to add stop' }, { status: 500 });
  }
}
