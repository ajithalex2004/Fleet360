import { NextRequest, NextResponse } from 'next/server';
import { Prisma } from '@prisma/client';
import { prisma } from '@/lib/prisma';
import { sendBookingActivatedWhatsApp } from '@/lib/whatsapp';
import {
  entityBelongsToTenant,
  recordOperationalChange,
  requireOperationalContext,
} from '@/lib/cross-module-governance';
import { ensureRentalGovernance } from '@/lib/rental-governance';
import { triggerServiceWorkflow } from '@/lib/runtime-workflows';

// POST /api/rental/bookings/[id]/activate
// Activates booking (vehicle handed over to customer), records checkout inspection
export async function POST(req: NextRequest, { params }: { params: { id: string } }) {
  await ensureRentalGovernance();
  try {
    const ctx = requireOperationalContext(req, 'rac', { write: true });
    if (ctx instanceof NextResponse) return ctx;
    if (!(await entityBelongsToTenant('rental_bookings', params.id, ctx.tenantId, { activeOnly: true }))) {
      return NextResponse.json({ error: 'Booking not found' }, { status: 404 });
    }
    const body = await req.json();
    const booking = await prisma.rentalBooking.findUnique({
      where: { id: params.id },
      include: { agreement: true, customer: true },
    });
    if (!booking) return NextResponse.json({ error: 'Booking not found' }, { status: 404 });
    if (!['CONFIRMED', 'PENDING'].includes(booking.status ?? '')) {
      return NextResponse.json({ error: `Cannot activate a booking in status: ${booking.status}` }, { status: 400 });
    }

    const ops: Prisma.PrismaPromise<unknown>[] = [
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
        })
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
        })
      );
    }

    const results = await prisma.$transaction(ops);
    await recordOperationalChange({
      req,
      ctx,
      entityType: 'RentalBooking',
      entityId: params.id,
      action: 'STATUS_CHANGE',
      before: booking,
      after: results[0],
      summary: `Activated rental booking ${booking.bookingRef ?? booking.id}.`,
    });

    const workflow = await triggerServiceWorkflow({
      req,
      ctx,
      serviceTypeKey: 'RAC_CHECKOUT_HANDOVER',
      referenceType: 'RentalBooking',
      referenceId: params.id,
      referenceNumber: booking.bookingRef ?? params.id,
      contextData: {
        bookingId: params.id,
        agreementId: booking.agreement?.id ?? null,
        mileageOut: body.mileage ?? null,
        fuelOut: body.fuelLevel ?? null,
        signedAt: body.signedAt ?? null,
        signedBy: body.signedBy ?? null,
        status: 'ACTIVE',
      },
    });

    // Best-effort WhatsApp activation message.
    void sendBookingActivatedWhatsApp(
      { fullName: booking.customer.fullName, phone: booking.customer.phone },
      {
        bookingRef: booking.bookingRef,
        pickupDate: booking.pickupDate,
        dropoffDate: booking.dropoffDate,
        pickupLocation: booking.pickupLocation,
        dropoffLocation: booking.dropoffLocation,
        vehicleCategory: booking.vehicleCategory,
        totalAmount: booking.totalAmount ? Number(booking.totalAmount) : null,
        currency: booking.currency ?? 'AED',
      },
    );

    return NextResponse.json({ booking: results[0], workflow });
  } catch (error) {
    console.error('Error activating booking:', error);
    return NextResponse.json({ error: 'Failed to activate booking' }, { status: 500 });
  }
}
