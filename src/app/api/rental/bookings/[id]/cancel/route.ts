import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';

// POST /api/rental/bookings/[id]/cancel
export async function POST(req: NextRequest, { params }: { params: { id: string } }) {
  try {
    const body = await req.json();
    const booking = await prisma.rentalBooking.findUnique({ where: { id: params.id } });
    if (!booking) return NextResponse.json({ error: 'Booking not found' }, { status: 404 });
    if (booking.status === 'COMPLETED' || booking.status === 'CANCELLED') {
      return NextResponse.json({ error: `Cannot cancel a booking in status: ${booking.status}` }, { status: 400 });
    }

    const ops: any[] = [
      prisma.rentalBooking.update({
        where: { id: params.id },
        data: {
          status: 'CANCELLED',
          notes: body.reason ? `CANCELLED: ${body.reason}${booking.notes ? '\n' + booking.notes : ''}` : booking.notes,
          updatedAt: new Date(),
        },
      }),
    ];

    // Cancel linked agreement if exists
    const agreement = await prisma.rentalAgreement.findUnique({ where: { bookingId: params.id } });
    if (agreement) {
      ops.push(
        prisma.rentalAgreement.update({
          where: { id: agreement.id },
          data: { status: 'CANCELLED' },
        })
      );
    }

    const results = await prisma.$transaction(ops);
    return NextResponse.json({ booking: results[0] });
  } catch (error) {
    console.error('Error cancelling booking:', error);
    return NextResponse.json({ error: 'Failed to cancel booking' }, { status: 500 });
  }
}
