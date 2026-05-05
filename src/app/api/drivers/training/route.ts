import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';

export async function GET(req: NextRequest) {
  try {
    const trainings = await prisma.driverTraining.findMany({
      where: { deletedAt: null },
      orderBy: { createdAt: 'desc' },
    });
    return NextResponse.json(trainings);
  } catch (error) {
    console.error('Error fetching trainings:', error);
    return NextResponse.json({ error: 'Failed to fetch trainings' }, { status: 500 });
  }
}

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const training = await prisma.driverTraining.create({ data: body });
    return NextResponse.json(training, { status: 201 });
  } catch (error) {
    console.error('Error creating training:', error);
    return NextResponse.json({ error: 'Failed to create training' }, { status: 500 });
  }
}
