import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';

export async function GET(req: NextRequest, { params }: { params: { id: string } }) {
  try {
    const schedule = await prisma.tripSchedule.findUnique({
      where: { id: params.id },
      include: {
        route: { include: { stops: { orderBy: { sequence: 'asc' } } } },
        passengers: { orderBy: { createdAt: 'asc' } },
        tripLogs: { orderBy: { createdAt: 'desc' } },
      },
    });
    if (!schedule) return NextResponse.json({ error: 'Not found' }, { status: 404 });
    return NextResponse.json(schedule);
  } catch (error) {
    return NextResponse.json({ error: 'Failed to fetch' }, { status: 500 });
  }
}

export async function PATCH(req: NextRequest, { params }: { params: { id: string } }) {
  try {
    const body = await req.json();
    const { route, passengers, tripLogs, ...data } = body;
    const schedule = await prisma.tripSchedule.update({
      where: { id: params.id },
      data: { ...data, updatedAt: new Date() },
      include: { route: true },
    });
    return NextResponse.json(schedule);
  } catch (error) {
    return NextResponse.json({ error: 'Failed to update' }, { status: 500 });
  }
}

export async function DELETE(req: NextRequest, { params }: { params: { id: string } }) {
  try {
    await prisma.tripSchedule.update({
      where: { id: params.id },
      data: { deletedAt: new Date(), status: 'CANCELLED' },
    });
    return NextResponse.json({ success: true });
  } catch (error) {
    return NextResponse.json({ error: 'Failed to delete' }, { status: 500 });
  }
}
