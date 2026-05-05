import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';

// POST /api/rental/bookings/[id]/complete
// Closes/completes a booking on vehicle return, records return inspection
export async function POST(req: NextRequest, { params }: { params: { id: string } }) {
  try {
    const body = await req.json();
    const booking = await prisma.rentalBooking.findUnique({
      where: { id: params.id },
      include: { agreement: true },
    });
    if (!booking) return NextResponse.json({ error: 'Booking not found' }, { status: 404 });
    if (booking.status !== 'ACTIVE') {
      return NextResponse.json({ error: `Cannot complete a booking in status: ${booking.status}` }, { status: 400 });
    }

    const ops: any[] = [
      prisma.rentalBooking.update({
        where: { id: params.id },
        data: { status: 'COMPLETED', updatedAt: new Date() },
      }),
    ];

    // Record return inspection
    if (body.mileage !== undefined || body.fuelLevel !== undefined) {
      ops.push(
        prisma.vehicleInspection.create({
          data: {
            bookingId: params.id,
            type: 'checkin',
            mileage: body.mileage ?? null,
            fuelLevel: body.fuelLevel ?? null,
            damages: body.damages ?? null,
            inspector: body.inspector ?? null,
            notes: body.notes ?? null,
          },
        })
      );
    }

    // Update agreement status
    if (booking.agreement) {
      const updateData: any = { status: 'COMPLETED' };
      if (body.mileage !== undefined) updateData.mileageIn = body.mileage;
      if (body.fuelLevel !== undefined) updateData.fuelIn = body.fuelLevel;
      ops.push(
        prisma.rentalAgreement.update({
          where: { id: booking.agreement.id },
          data: updateData,
        })
      );
    }

    // Create damage claims if reported
    if (body.damages && body.estimatedDamageCost) {
      ops.push(
        prisma.damageClaim.create({
          data: {
            bookingId: params.id,
            description: body.damages,
            estimatedCost: body.estimatedDamageCost,
            status: 'OPEN',
            insuranceClaim: body.insuranceClaim ?? false,
          },
        })
      );
    }

    const results = await prisma.$transaction(ops);
    return NextResponse.json({ booking: results[0] });
  } catch (error) {
    console.error('Error completing booking:', error);
    return NextResponse.json({ error: 'Failed to complete booking' }, { status: 500 });
  }
}
