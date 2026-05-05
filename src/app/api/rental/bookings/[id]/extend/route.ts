import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';

// POST /api/rental/bookings/[id]/extend
export async function POST(req: NextRequest, { params }: { params: { id: string } }) {
  try {
    const body = await req.json();
    const { newEndDate, reason, approvedBy } = body;
    if (!newEndDate) return NextResponse.json({ error: 'newEndDate is required' }, { status: 400 });

    const booking = await prisma.rentalBooking.findUnique({
      where: { id: params.id },
      include: { agreement: true },
    });
    if (!booking) return NextResponse.json({ error: 'Booking not found' }, { status: 404 });
    if (!['CONFIRMED', 'ACTIVE'].includes(booking.status ?? '')) {
      return NextResponse.json({ error: `Cannot extend a booking in status: ${booking.status}` }, { status: 400 });
    }

    const currentEnd = booking.dropoffDate;
    const newEnd = new Date(newEndDate);
    if (newEnd <= currentEnd) {
      return NextResponse.json({ error: 'New end date must be after the current dropoff date' }, { status: 400 });
    }

    const extraDays = Math.ceil((newEnd.getTime() - currentEnd.getTime()) / (1000 * 60 * 60 * 24));
    const dailyRate = Number(booking.dailyRate ?? 0);
    const extraAmount = extraDays * dailyRate;

    const ops: any[] = [
      prisma.rentalBooking.update({
        where: { id: params.id },
        data: {
          dropoffDate: newEnd,
          totalDays: (booking.totalDays ?? 0) + extraDays,
          totalAmount: { increment: extraAmount },
          updatedAt: new Date(),
        },
      }),
    ];

    if (booking.agreement) {
      ops.push(
        prisma.rentalExtension.create({
          data: {
            agreementId: booking.agreement.id,
            originalEndDate: currentEnd,
            newEndDate: newEnd,
            extraDays,
            extraAmount,
            reason: reason ?? null,
            approvedBy: approvedBy ?? null,
            status: 'APPROVED',
          },
        }),
        prisma.rentalAgreement.update({
          where: { id: booking.agreement.id },
          data: {
            endDate: newEnd,
            totalAmount: { increment: extraAmount },
          },
        })
      );
    }

    const results = await prisma.$transaction(ops);
    return NextResponse.json({ booking: results[0], extraDays, extraAmount });
  } catch (error) {
    console.error('Error extending booking:', error);
    return NextResponse.json({ error: 'Failed to extend booking' }, { status: 500 });
  }
}
