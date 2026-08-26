import { NextRequest, NextResponse } from 'next/server';
import { requireAuthorizedTenant, stripTenantOwnershipFields } from '@/lib/tenant-context';
import { Prisma } from '@prisma/client';
import { prisma } from '@/lib/prisma';
import { withTenantRls, runSequential } from '@/lib/rls';
import { sendBookingActivatedWhatsApp } from '@/lib/whatsapp';

// POST /api/rental/bookings/[id]/activate
// Activates booking (vehicle handed over to customer), records checkout inspection
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
          include: { agreement: true, customer: true },
        });
        if (!booking) return NextResponse.json({ error: 'Booking not found' }, { status: 404 });
        if (!['CONFIRMED', 'PENDING'].includes(booking.status ?? '')) {
          return NextResponse.json({ error: `Cannot activate a booking in status: ${booking.status}` }, { status: 400 });
        }

        const ops: Prisma.PrismaPromise<unknown>[] = [
          tx.rentalBooking.update({
            where: { id: params.id, tenantId },
            data: { status: 'ACTIVE', updatedAt: new Date() },
          }),
        ];

        // Record checkout inspection
        if (body.mileage !== undefined || body.fuelLevel !== undefined) {
          ops.push(
            tx.vehicleInspection.create({
              data: {
                tenantId,
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
            tx.rentalAgreement.update({
              where: { id: booking.agreement.id, tenantId },
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

        const results = await runSequential(ops as any);

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

        return NextResponse.json({ booking: results[0] });
        } catch (e) {
        console.error('Error activating booking:', e);
        return NextResponse.json({ error: 'Failed to activate booking' }, { status: 500 });
      }
  });
}

