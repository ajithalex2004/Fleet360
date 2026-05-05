import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';

export async function GET(req: NextRequest) {
  try {
    const { searchParams } = new URL(req.url);
    const tripId = searchParams.get('tripId');
    const passengers = await prisma.tripPassenger.findMany({
      where: tripId ? { tripId } : {},
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
    const body = await req.json();
    const passenger = await prisma.tripPassenger.create({
      data: body,
      include: { trip: true },
    });
    // Increment trip confirmed count
    await prisma.tripSchedule.update({
      where: { id: body.tripId },
      data: { confirmedCount: { increment: 1 } },
    });
    return NextResponse.json(passenger, { status: 201 });
  } catch (error) {
    console.error('Error creating passenger:', error);
    return NextResponse.json({ error: 'Failed to create passenger' }, { status: 500 });
  }
}
