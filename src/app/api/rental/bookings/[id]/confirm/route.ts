import { NextRequest, NextResponse } from 'next/server';
import { requireAuthorizedTenant, stripTenantOwnershipFields } from '@/lib/tenant-context';
import { prisma } from '@/lib/prisma';
import { withTenantRls, runSequential } from '@/lib/rls';
import { sendBookingConfirmedWhatsApp } from '@/lib/whatsapp';

// POST /api/rental/bookings/[id]/confirm
// Confirms a PENDING booking and generates a RentalAgreement
export async function POST(req: NextRequest, props: { params: Promise<{ id: string }> }) {
  const params = await props.params;

  const authz = requireAuthorizedTenant(req);
  if (!authz.ok) {
    return NextResponse.json({ error: authz.error }, { status: authz.status });
  }
  const { tenantId } = authz;

  return withTenantRls(prisma, tenantId, async (tx) => {
    try {
        const bodyRaw = await req.json();
      const body = stripTenantOwnershipFields(bodyRaw);
        const booking = await tx.rentalBooking.findUnique({
          where: { id: params.id, tenantId },
          include: { customer: true },
        });
        if (!booking) return NextResponse.json({ error: 'Booking not found' }, { status: 404 });
        if (booking.status !== 'PENDING') {
          return NextResponse.json({ error: `Cannot confirm a booking in status: ${booking.status}` }, { status: 400 });
        }

        // Generate agreement number
        const count = await tx.rentalAgreement.count({ where: { tenantId } });
        const agreementNo = `AGR-${String(count + 1).padStart(5, '0')}`;

        const [updatedBooking, agreement] = await runSequential([
          tx.rentalBooking.update({
            where: { id: params.id, tenantId },
            data: { status: 'CONFIRMED', updatedAt: new Date() },
          }),
          tx.rentalAgreement.create({
            data: {
              tenantId,
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

        return NextResponse.json({ booking: updatedBooking, agreement });
        } catch (e) {
        console.error('Error confirming booking:', e);
        return NextResponse.json({ error: 'Failed to confirm booking' }, { status: 500 });
      }
  });
}

