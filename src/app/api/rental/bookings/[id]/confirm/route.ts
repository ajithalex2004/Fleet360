import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { sendBookingConfirmedWhatsApp } from '@/lib/whatsapp';
import {
  attachTenantToEntity,
  entityBelongsToTenant,
  recordOperationalChange,
  requireOperationalContext,
} from '@/lib/cross-module-governance';
import { ensureRentalGovernance } from '@/lib/rental-governance';
import { triggerServiceWorkflow } from '@/lib/runtime-workflows';

// POST /api/rental/bookings/[id]/confirm
// Confirms a PENDING booking and generates a RentalAgreement
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
      include: { customer: true },
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
    await attachTenantToEntity('rental_agreements', agreement.id, ctx.tenantId);
    await recordOperationalChange({
      req,
      ctx,
      entityType: 'RentalBooking',
      entityId: params.id,
      action: 'STATUS_CHANGE',
      before: booking,
      after: updatedBooking,
      summary: `Confirmed rental booking ${updatedBooking.bookingRef ?? updatedBooking.id} and created agreement ${agreement.agreementNo}.`,
    });

    const workflow = await triggerServiceWorkflow({
      req,
      ctx,
      serviceTypeKey: 'RAC_RENTAL_AGREEMENT',
      referenceType: 'RentalAgreement',
      referenceId: agreement.id,
      referenceNumber: agreement.agreementNo ?? agreement.id,
      contextData: {
        bookingId: updatedBooking.id,
        bookingRef: updatedBooking.bookingRef,
        agreementId: agreement.id,
        agreementNo,
        customerId: booking.customerId,
        vehicleId: booking.vehicleId,
        totalAmount: booking.totalAmount ?? null,
        status: updatedBooking.status,
      },
    });

    // Best-effort WhatsApp confirmation (never fails the request).
    void sendBookingConfirmedWhatsApp(
      { fullName: booking.customer.fullName, phone: booking.customer.phone },
      {
        bookingRef: updatedBooking.bookingRef,
        pickupDate: updatedBooking.pickupDate,
        dropoffDate: updatedBooking.dropoffDate,
        pickupLocation: updatedBooking.pickupLocation,
        dropoffLocation: updatedBooking.dropoffLocation,
        vehicleCategory: updatedBooking.vehicleCategory,
        totalAmount: updatedBooking.totalAmount ? Number(updatedBooking.totalAmount) : null,
        currency: updatedBooking.currency ?? 'AED',
      },
    );

    return NextResponse.json({ booking: updatedBooking, agreement, workflow });
  } catch (error) {
    console.error('Error confirming booking:', error);
    return NextResponse.json({ error: 'Failed to confirm booking' }, { status: 500 });
  }
}
