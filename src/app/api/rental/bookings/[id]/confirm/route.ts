import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';

// POST /api/rental/bookings/[id]/confirm
// Confirms a PENDING booking and generates a RentalAgreement
export async function POST(req: NextRequest, { params }: { params: { id: string } }) {
  try {
    const body = await req.json();
    const booking = await prisma.rentalBooking.findUnique({
      where: { id: params.id },
    });
    if (!booking) return NextResponse.json({ error: 'Booking not found' }, { status: 404 });
    if (booking.status !== 'PENDING') {
      return NextResponse.json({ error: `Cannot confirm a booking in status: ${booking.status}` }, { status: 400 });
    }

    // Generate agreement number
    const count = await prisma.rentalAgreement.count();
    const agreementNo = `AGR-${String(count + 1).padStart(5, '0')}`;

    const [updatedBooking, agreement] = await prisma.$transaction([
      prisma.rentalBooking.update({
        where: { id: params.id },
        data: { status: 'CONFIRMED', updatedAt: new Date() },
      }),
      prisma.rentalAgreement.create({
        data: {
          agreementNo,
          bookingId: params.id,
          customerId: booking.customerId,
          vehicleId: booking.vehicleId,
          startDate: booking.pickupDate,
          endDate: booking.dropoffDate,
          dailyRate: booking.dailyRate,
          totalAmount: booking.totalAmount,
          securityDeposit: body.securityDeposit ?? null,
          status: 'DRAFT',
        },
      }),
    ]);

    return NextResponse.json({ booking: updatedBooking, agreement });
  } catch (error) {
    console.error('Error confirming booking:', error);
    return NextResponse.json({ error: 'Failed to confirm booking' }, { status: 500 });
  }
}
