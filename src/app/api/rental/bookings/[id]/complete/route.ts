export const dynamic = 'force-dynamic';

import { NextRequest, NextResponse } from 'next/server';
import { requireAuthorizedTenant, stripTenantOwnershipFields } from '@/lib/tenant-context';
import { prisma } from '@/lib/prisma';
import { withTenantRls, runSequential } from '@/lib/rls';

// POST /api/rental/bookings/[id]/complete
// Closes/completes a booking on vehicle return, records return inspection
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
          include: { agreement: true },
        });
        if (!booking) return NextResponse.json({ error: 'Booking not found' }, { status: 404 });
        if (booking.status !== 'ACTIVE') {
          return NextResponse.json({ error: `Cannot complete a booking in status: ${booking.status}` }, { status: 400 });
        }

        const ops: any[] = [
          tx.rentalBooking.update({
            where: { id: params.id, tenantId },
            data: { status: 'COMPLETED', updatedAt: new Date() },
          }),
        ];

        // Record return inspection
        if (body.mileage !== undefined || body.fuelLevel !== undefined) {
          ops.push(
            tx.vehicleInspection.create({
              data: {
                tenantId,
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
            tx.rentalAgreement.update({
              where: { id: booking.agreement.id, tenantId },
              data: updateData,
            })
          );
        }

        // Create damage claims if reported
        if (body.damages && body.estimatedDamageCost) {
          ops.push(
            tx.damageClaim.create({
              data: {
                tenantId,
                bookingId: params.id,
                description: body.damages,
                estimatedCost: body.estimatedDamageCost,
                status: 'OPEN',
                insuranceClaim: body.insuranceClaim ?? false,
              },
            })
          );
        }

        const results = await runSequential(ops);
        return NextResponse.json({ booking: results[0] });
        } catch (e) {
        console.error('Error completing booking:', e);
        return NextResponse.json({ error: 'Failed to complete booking' }, { status: 500 });
      }
  });
}

