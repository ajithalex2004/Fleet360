import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';

export async function GET(req: NextRequest) {
  try {
    const reportSchedules = await prisma.reportSchedule.findMany({
      where: { deletedAt: null },
      orderBy: { createdAt: 'desc' },
    });
    return NextResponse.json(reportSchedules);
  } catch (error) {
    console.error('Error fetching report schedules:', error);
    return NextResponse.json({ error: 'Failed to fetch report schedules' }, { status: 500 });
  }
}

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const reportSchedule = await prisma.reportSchedule.create({ data: body });
    return NextResponse.json(reportSchedule, { status: 201 });
  } catch (error) {
    console.error('Error creating report schedule:', error);
    return NextResponse.json({ error: 'Failed to create report schedule' }, { status: 500 });
  }
}
