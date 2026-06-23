import { NextRequest, NextResponse } from 'next/server';
import { Prisma } from '@prisma/client';
import { prisma } from '@/lib/prisma';
import {
  entityBelongsToTenant,
  recordOperationalChange,
  requireOperationalContext,
} from '@/lib/cross-module-governance';
import { ensureRentalGovernance } from '@/lib/rental-governance';
import { triggerServiceWorkflow } from '@/lib/runtime-workflows';

// POST /api/rental/bookings/[id]/complete
// Closes/completes a booking on vehicle return, records return inspection
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
      include: { agreement: true },
    });
    if (!booking) return NextResponse.json({ error: 'Booking not found' }, { status: 404 });
    if (booking.status !== 'ACTIVE') {
      return NextResponse.json({ error: `Cannot complete a booking in status: ${booking.status}` }, { status: 400 });
    }

    const mileage = body.mileage !== undefined ? Number(body.mileage) : undefined;
    const fuelLevel = body.fuelLevel !== undefined ? Number(body.fuelLevel) : undefined;

    const ops: Prisma.PrismaPromise<unknown>[] = [
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
            mileage: Number.isFinite(mileage) ? mileage : null,
            fuelLevel: Number.isFinite(fuelLevel) ? fuelLevel : null,
            damages: body.damages ?? null,
            inspector: body.inspector ?? null,
            notes: body.notes ?? null,
          },
        })
      );
    }

    // Update agreement status
    if (booking.agreement) {
      const updateData: { status: 'COMPLETED'; mileageIn?: number | null; fuelIn?: number | null } = { status: 'COMPLETED' };
      if (body.mileage !== undefined) updateData.mileageIn = Number.isFinite(mileage) ? mileage : null;
      if (body.fuelLevel !== undefined) updateData.fuelIn = Number.isFinite(fuelLevel) ? fuelLevel : null;
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
    await recordOperationalChange({
      req,
      ctx,
      entityType: 'RentalBooking',
      entityId: params.id,
      action: 'STATUS_CHANGE',
      before: booking,
      after: results[0],
      summary: `Completed rental booking ${booking.bookingRef ?? booking.id}.`,
    });

    const workflowEvents = [
      await triggerServiceWorkflow({
        req,
        ctx,
        serviceTypeKey: 'RAC_CHECKIN_RETURN',
        referenceType: 'RentalBooking',
        referenceId: params.id,
        referenceNumber: booking.bookingRef ?? params.id,
        contextData: {
          bookingId: params.id,
          agreementId: booking.agreement?.id ?? null,
          mileageIn: body.mileage ?? null,
          fuelIn: body.fuelLevel ?? null,
          status: 'COMPLETED',
        },
      }),
    ];

    if (body.damages && body.estimatedDamageCost) {
      workflowEvents.push(await triggerServiceWorkflow({
        req,
        ctx,
        serviceTypeKey: 'RAC_DAMAGE_INSPECTION',
        referenceType: 'DamageClaim',
        referenceId: params.id,
        referenceNumber: booking.bookingRef ?? params.id,
        contextData: {
          bookingId: params.id,
          damages: body.damages,
          estimatedDamageCost: body.estimatedDamageCost,
          insuranceClaim: body.insuranceClaim ?? false,
        },
      }));
    }

    return NextResponse.json({ booking: results[0], workflowEvents });
  } catch (error) {
    console.error('Error completing booking:', error);
    return NextResponse.json({ error: 'Failed to complete booking' }, { status: 500 });
  }
}
