import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';

export async function GET(req: NextRequest, { params }: { params: { id: string } }) {
  try {
    const route = await prisma.busRoute.findUnique({
      where: { id: params.id },
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
  } catch (error) {
    return NextResponse.json({ error: 'Failed to fetch' }, { status: 500 });
  }
}

export async function PATCH(req: NextRequest, { params }: { params: { id: string } }) {
  try {
    const body = await req.json();
    const { stops, schedules, ...data } = body;
    const route = await prisma.busRoute.update({
      where: { id: params.id },
      data: { ...data, updatedAt: new Date() },
      include: { stops: { orderBy: { sequence: 'asc' } } },
    });
    return NextResponse.json(route);
  } catch (error) {
    return NextResponse.json({ error: 'Failed to update' }, { status: 500 });
  }
}

export async function DELETE(req: NextRequest, { params }: { params: { id: string } }) {
  try {
    await prisma.busRoute.update({
      where: { id: params.id },
      data: { deletedAt: new Date(), isActive: false },
    });
    return NextResponse.json({ success: true });
  } catch (error) {
    return NextResponse.json({ error: 'Failed to delete' }, { status: 500 });
  }
}
