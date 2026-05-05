import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';

export async function GET(req: NextRequest) {
  try {
    const performances = await prisma.driverPerformance.findMany({
      where: { deletedAt: null },
      orderBy: { createdAt: 'desc' },
    });
    return NextResponse.json(performances);
  } catch (error) {
    console.error('Error fetching performances:', error);
    return NextResponse.json({ error: 'Failed to fetch performances' }, { status: 500 });
  }
}

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const performance = await prisma.driverPerformance.create({ data: body });
    return NextResponse.json(performance, { status: 201 });
  } catch (error) {
    console.error('Error creating performance:', error);
    return NextResponse.json({ error: 'Failed to create performance' }, { status: 500 });
  }
}
