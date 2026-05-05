import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';

export async function GET(req: NextRequest, { params }: { params: { id: string } }) {
  try {
    const stops = await prisma.routeStop.findMany({
      where: { routeId: params.id },
      orderBy: { sequence: 'asc' },
    });
    return NextResponse.json(stops);
  } catch (error) {
    return NextResponse.json({ error: 'Failed to fetch' }, { status: 500 });
  }
}

// Replace all stops for a route (reorder/rebuild)
export async function PUT(req: NextRequest, { params }: { params: { id: string } }) {
  try {
    const body = await req.json();
    const stops = body.stops ?? body;
    await prisma.$transaction([
      prisma.routeStop.deleteMany({ where: { routeId: params.id } }),
      prisma.routeStop.createMany({
        data: stops.map((s: any, i: number) => ({
          routeId: params.id,
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
      where: { routeId: params.id },
      orderBy: { sequence: 'asc' },
    });
    return NextResponse.json(newStops);
  } catch (error) {
    return NextResponse.json({ error: 'Failed to update stops' }, { status: 500 });
  }
}

export async function POST(req: NextRequest, { params }: { params: { id: string } }) {
  try {
    const body = await req.json();
    const maxSeq = await prisma.routeStop.aggregate({
      where: { routeId: params.id },
      _max: { sequence: true },
    });
    const stop = await prisma.routeStop.create({
      data: {
        routeId: params.id,
        stopName: body.stopName,
        sequence: body.sequence ?? (maxSeq._max.sequence ?? 0) + 1,
        gpsLat: body.gpsLat ?? null,
        gpsLng: body.gpsLng ?? null,
        estimatedArrivalMins: body.estimatedArrivalMins ?? null,
        landmark: body.landmark ?? null,
      },
    });
    return NextResponse.json(stop, { status: 201 });
  } catch (error) {
    return NextResponse.json({ error: 'Failed to add stop' }, { status: 500 });
  }
}
