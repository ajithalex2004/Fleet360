import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';

export async function GET(req: NextRequest) {
  try {
    const tenantId = req.headers.get('x-tenant-id');
    if (!tenantId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    const { searchParams } = new URL(req.url);
    const tripId = searchParams.get('tripId');
    const passengers = await prisma.tripPassenger.findMany({
      where: { tenantId, ...(tripId ? { tripId } : {}) },
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
    const tenantId = req.headers.get('x-tenant-id');
    if (!tenantId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    const body = await req.json();
    const passenger = await prisma.tripPassenger.create({
      data: { ...body, tenantId },
      include: { trip: true },
    });
    // Recount confirmedCount from the source of truth (TripPassenger rows)
    // instead of `increment: 1`. The roster-expansion helper
    // (src/lib/bus-ops/expand-roster.ts) also updates this field by
    // re-counting; using increment here would race under concurrent
    // creates + expansions and could double- or under-count on retries.
    // A single point of truth avoids drift.
    const attendance = await prisma.tripPassenger.count({
      where: { tripId: body.tripId, deletedAt: null },
    });
    await prisma.tripSchedule.update({
      where: { id: body.tripId },
      data: { confirmedCount: attendance },
    });
    return NextResponse.json(passenger, { status: 201 });
  } catch (error) {
    console.error('Error creating passenger:', error);
    return NextResponse.json({ error: 'Failed to create passenger' }, { status: 500 });
  }
}
