import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';

export async function POST(req: NextRequest, { params }: { params: { id: string } }) {
  try {
    const body = await req.json();
    const schedule = await prisma.tripSchedule.findUnique({ where: { id: params.id } });
    if (!schedule) return NextResponse.json({ error: 'Not found' }, { status: 404 });
    if (!['DEPARTED', 'IN_TRANSIT', 'SCHEDULED'].includes(schedule.status ?? '')) {
      return NextResponse.json({ error: `Cannot complete from status: ${schedule.status}` }, { status: 400 });
    }

    // Find the latest trip log and update it
    const latestLog = await prisma.tripLog.findFirst({
      where: { scheduleId: params.id },
      orderBy: { createdAt: 'desc' },
    });

    const ops: any[] = [
      prisma.tripSchedule.update({
        where: { id: params.id },
        data: { status: 'COMPLETED', updatedAt: new Date() },
      }),
    ];

    if (latestLog) {
      ops.push(prisma.tripLog.update({
        where: { id: latestLog.id },
        data: {
          actualArrivalTime: body.arrivalTime ? new Date(body.arrivalTime) : new Date(),
          endMileage: body.endMileage ?? null,
          fuelUsed: body.fuelUsed ?? null,
          passengersBoarded: body.passengersBoarded ?? null,
          driverNotes: body.driverNotes ?? null,
        },
      }));
    } else {
      ops.push(prisma.tripLog.create({
        data: {
          scheduleId: params.id,
          actualArrivalTime: new Date(),
          passengersBoarded: body.passengersBoarded ?? null,
          loggedBy: body.loggedBy ?? null,
        },
      }));
    }

    const results = await prisma.$transaction(ops);
    return NextResponse.json({ schedule: results[0] });
  } catch (error) {
    return NextResponse.json({ error: 'Failed to complete' }, { status: 500 });
  }
}
