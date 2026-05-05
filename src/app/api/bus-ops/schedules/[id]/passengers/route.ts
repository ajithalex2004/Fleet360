import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';

export async function GET(req: NextRequest, { params }: { params: { id: string } }) {
  try {
    const passengers = await prisma.tripPassenger.findMany({
      where: { tripId: params.id },
      orderBy: { employeeName: 'asc' },
    });
    return NextResponse.json(passengers);
  } catch (error) {
    return NextResponse.json({ error: 'Failed to fetch' }, { status: 500 });
  }
}
