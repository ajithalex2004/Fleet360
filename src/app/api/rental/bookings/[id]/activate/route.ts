import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';

// POST /api/rental/bookings/[id]/activate
// Activates booking (vehicle handed over to customer), records checkout inspection
export async function POST(req: NextRequest, { params }: { params: { id: string } }) {
  try {
    const body = await req.json();
    const booking = await prisma.rentalBooking.findUnique({
      where: { id: params.id },
      include: { agreement: true },
    });
    if (!booking) return NextResponse.json({ error: 'Booking not found' }, { status: 404 });
    if (!['CONFIRMED', 'PENDING'].includes(booking.status ?? '')) {
      return NextResponse.json({ error: `Cannot activate a booking in status: ${booking.status}` }, { status: 400 });
    }

    const ops: Parameters<typeof prisma.$transaction>[0] = [
      prisma.rentalBooking.update({
        where: { id: params.id },
        data: { status: 'ACTIVE', updatedAt: new Date() },
      }),
    ];

    // Record checkout inspection
    if (body.mileage !== undefined || body.fuelLevel !== undefined) {
      ops.push(
        prisma.vehicleInspection.create({
          data: {
            bookingId: params.id,
            type: 'checkout',
            mileage: body.mileage ?? null,
            fuelLevel: body.fuelLevel ?? null,
            damages: body.damages ?? null,
            inspector: body.inspector ?? null,
            notes: body.notes ?? null,
          },
        }) as any
      );
    }

    // Update agreement with checkout mileage/fuel
    if (booking.agreement) {
      ops.push(
        prisma.rentalAgreement.update({
          where: { id: booking.agreement.id },
          data: {
            mileageOut: body.mileage ?? null,
            fuelOut: body.fuelLevel ?? null,
            status: 'ACTIVE',
            signedAt: body.signedAt ? new Date(body.signedAt) : new Date(),
            signedBy: body.signedBy ?? null,
          },
        }) as any
      );
    }

    const results = await prisma.$transaction(ops as any);
    return NextResponse.json({ booking: results[0] });
  } catch (error) {
    console.error('Error activating booking:', error);
    return NextResponse.json({ error: 'Failed to activate booking' }, { status: 500 });
  }
}
