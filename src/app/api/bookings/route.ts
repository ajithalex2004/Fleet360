import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';

export async function GET(req: NextRequest) {
  try {
    const sp          = req.nextUrl.searchParams;
    const serviceType = sp.get('serviceType');
    const status      = sp.get('status');
    const limit       = Math.min(parseInt(sp.get('limit') ?? '200', 10), 500);

    const where: Record<string, unknown> = { deletedAt: null };
    if (serviceType) where.serviceType = serviceType;
    if (status)      where.status      = status;

    const bookings = await prisma.booking.findMany({
      where,
      orderBy: { createdAt: 'desc' },
      take: limit,
    });
    return NextResponse.json(bookings);
  } catch (error) {
    console.error('Error fetching bookings:', error);
    return NextResponse.json({ error: 'Failed to fetch bookings' }, { status: 500 });
  }
}

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const booking = await prisma.booking.create({ data: body });
    return NextResponse.json(booking, { status: 201 });
  } catch (error) {
    console.error('Error creating booking:', error);
    return NextResponse.json({ error: 'Failed to create booking' }, { status: 500 });
  }
}
