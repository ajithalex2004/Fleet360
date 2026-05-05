import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';

export async function GET(req: NextRequest) {
  try {
    const { searchParams } = new URL(req.url);
    const bookingId = searchParams.get('bookingId');
    const inspections = await prisma.vehicleInspection.findMany({
      where: bookingId ? { bookingId } : {},
      include: { booking: { include: { customer: true } } },
      orderBy: { createdAt: 'desc' },
    });
    return NextResponse.json(inspections);
  } catch (error) {
    return NextResponse.json({ error: 'Failed to fetch' }, { status: 500 });
  }
}

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const inspection = await prisma.vehicleInspection.create({ data: body });
    return NextResponse.json(inspection, { status: 201 });
  } catch (error) {
    return NextResponse.json({ error: 'Failed to create' }, { status: 500 });
  }
}
