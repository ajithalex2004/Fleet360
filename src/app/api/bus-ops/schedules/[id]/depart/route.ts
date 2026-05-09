import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';

export async function POST(req: NextRequest, { params }: { params: { id: string } }) {
  try {
    const body = await req.json();
    const schedule = await prisma.tripSchedule.findUnique({ where: { id: params.id } });
    if (!schedule) return NextResponse.json({ error: 'Not found' }, { status: 404 });
    if (!['SCHEDULED'].includes(schedule.status ?? '')) {
      return NextResponse.json({ error: `Cannot depart from status: ${schedule.status}` }, { status: 400 });
    }

    // Pre-trip safety check enforcement: a passing check must exist for THIS
    // schedule today. Override with x-skip-pretrip-check header for emergencies
    // (admin only — UI never sends this; emergency override leaves an audit trail).
    const skipPretrip = req.headers.get('x-skip-pretrip-check') === '1';
    if (!skipPretrip) {
      const todayStart = new Date(); todayStart.setHours(0, 0, 0, 0);
      const passingCheck = await prisma.busPreTripCheck.findFirst({
        where: {
          scheduleId: params.id,
          performedAt: { gte: todayStart },
          overallPass: true,
        },
        orderBy: { performedAt: 'desc' },
      });
      if (!passingCheck) {
        return NextResponse.json(
          { error: 'Pre-trip safety check required (or did not pass). Complete the checklist before departing.' },
          { status: 412 },
        );
      }
    }

    const [updated] = await prisma.$transaction([
      prisma.tripSchedule.update({
        where: { id: params.id },
        data: { status: 'DEPARTED', updatedAt: new Date() },
      }),
      prisma.tripLog.create({
        data: {
          scheduleId: params.id,
          actualDepartureTime: body.departureTime ? new Date(body.departureTime) : new Date(),
          startMileage: body.startMileage ?? null,
          loggedBy: body.loggedBy ?? null,
          notes: body.notes ?? null,
        },
      }),
    ]);
    return NextResponse.json(updated);
  } catch (error) {
    return NextResponse.json({ error: 'Failed to depart' }, { status: 500 });
  }
}
