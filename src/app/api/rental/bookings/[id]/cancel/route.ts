export const dynamic = 'force-dynamic';

import { NextRequest, NextResponse } from 'next/server';
import { requireAuthorizedTenant, stripTenantOwnershipFields } from '@/lib/tenant-context';
import { prisma } from '@/lib/prisma';
import { withTenantRls } from '@/lib/rls';
import { withdrawApproval } from '@/lib/workflow/approvals';
import { requireRentalPermission } from '@/lib/rental/rbac';
import { canTransition, type BookingStatus } from '@/lib/rental-booking-state';
import {
  computeSafePostRentalVehicleStatus,
  withRentalLock,
  withSavepoint,
} from '@/lib/rental/locks';
import { resolveInputFuelPct } from '@/lib/rental/fuel-odometer';

// POST /api/rental/bookings/[id]/cancel
export async function POST(req: NextRequest, props: { params: Promise<{ id: string }> }) {
  const params = await props.params;

  const authz = requireAuthorizedTenant(req);
  if (!authz.ok) {
    return NextResponse.json({ error: authz.error }, { status: authz.status });
  }
  const { tenantId } = authz;

  const denied = await requireRentalPermission(
    req.headers,
    tenantId,
    'delete',
    'bookings',
    req.nextUrl.pathname,
  );
  if (denied) return denied;

  const response = await withTenantRls(prisma, tenantId, async (tx) => {
    try {
      const bodyRaw = await req.json().catch(() => ({}));
      const body = stripTenantOwnershipFields(
        (bodyRaw && typeof bodyRaw === 'object' ? bodyRaw : {}) as Record<string, unknown>,
      );

      const booking = await tx.rentalBooking.findFirst({
        where: { id: params.id, tenantId, deletedAt: null },
      });
      if (!booking) {
        return NextResponse.json({ error: 'Booking not found' }, { status: 404 });
      }

      const agreement = await tx.rentalAgreement.findFirst({
        where: { bookingId: params.id, tenantId },
      });

      const currentStatus = (booking.status ?? 'PENDING').toUpperCase();
      const agrStatus = (agreement?.status ?? '').toUpperCase();

      // Strictly forbid cancelling an ACTIVE booking or ACTIVE rental agreement
      if (currentStatus === 'ACTIVE' || agrStatus === 'ACTIVE') {
        return NextResponse.json(
          {
            error:
              'Cannot cancel an ACTIVE booking after vehicle handover; process vehicle return instead',
          },
          { status: 409 },
        );
      }

      if (currentStatus === 'CANCELLED') {
        return NextResponse.json(
          { error: 'Booking is already cancelled' },
          { status: 409 },
        );
      }

      const transition = canTransition(currentStatus as BookingStatus, 'CANCELLED');
      if (!transition.ok) {
        return NextResponse.json(
          { error: `Cannot cancel a booking in status: ${booking.status}` },
          { status: 409 },
        );
      }

      const assignedVehicleId = booking.vehicleId ?? agreement?.vehicleId ?? null;

      const cancelUnderLock = async () => {
        const now = new Date();
        const updatedBooking = await tx.rentalBooking.update({
          where: { id: params.id, tenantId },
          data: {
            status: 'CANCELLED',
            notes: body.reason
              ? `CANCELLED: ${String(body.reason)}${booking.notes ? '\n' + booking.notes : ''}`
              : booking.notes,
            updatedAt: now,
          },
        });

        // Cancel linked DRAFT agreement if exists (and sync any optional return odometer/fuel)
        if (agreement && agrStatus !== 'CLOSED' && agrStatus !== 'COMPLETED') {
          const returnFuelPct = resolveInputFuelPct(body, 'return', 'PCT');
          const rawOdo =
            body.mileageIn ?? body.returnOdometer ?? body.odometerReading ?? body.mileage;
          const parsedOdo = rawOdo != null && rawOdo !== '' ? Number(rawOdo) : Number.NaN;
          const mileageInt =
            Number.isFinite(parsedOdo) && parsedOdo >= 0 ? Math.round(parsedOdo) : null;

          await tx.rentalAgreement.update({
            where: { id: agreement.id, tenantId },
            data: {
              status: 'CANCELLED',
              ...(mileageInt != null ? { mileageIn: mileageInt } : {}),
              updatedAt: now,
            },
          });

          if (mileageInt != null || returnFuelPct != null) {
            await withSavepoint(
              tx,
              'cancel_sync_agr_cols',
              () =>
                tx.$executeRawUnsafe(
                  `UPDATE rental_agreements
                      SET return_odometer = COALESCE($1, return_odometer),
                          mileage_in = COALESCE($1, mileage_in),
                          return_fuel_level = COALESCE($2, return_fuel_level)
                    WHERE id::text = $3 AND tenant_id::text = $4`,
                  mileageInt,
                  returnFuelPct,
                  agreement.id,
                  tenantId,
                ),
              0,
            );
          }
        }

        // Safely release assigned vehicle using computeSafePostRentalVehicleStatus
        // (never overwrites GROUNDED/MAINTENANCE or another active agreement/imminent reservation)
        if (assignedVehicleId) {
          await withSavepoint(
            tx,
            'cancel_release_vehicle',
            async () => {
              if (typeof (tx as { $queryRawUnsafe?: unknown }).$queryRawUnsafe === 'function') {
                const { status: safeStatus } = await computeSafePostRentalVehicleStatus(tx, {
                  tenantId,
                  vehicleId: assignedVehicleId,
                  excludeAgreementId: agreement?.id ?? null,
                  excludeBookingId: booking.id,
                });
                if (typeof tx.vehicle?.updateMany === 'function') {
                  await tx.vehicle.updateMany({
                    where: {
                      id: assignedVehicleId,
                      tenantId,
                      status: { in: ['RESERVED', 'RENTED'] },
                    },
                    data: { status: safeStatus, updatedAt: now },
                  });
                }
              } else if (typeof tx.vehicle?.updateMany === 'function') {
                await tx.vehicle.updateMany({
                  where: {
                    id: assignedVehicleId,
                    tenantId,
                    status: { in: ['RESERVED', 'RENTED'] },
                  },
                  data: { status: 'AVAILABLE', updatedAt: now },
                });
              }
            },
            undefined,
          );
        }

        return NextResponse.json({ booking: updatedBooking });
      };

      if (typeof (tx as { $executeRawUnsafe?: unknown }).$executeRawUnsafe === 'function') {
        return await withRentalLock(
          tx,
          tenantId,
          { entityKey: params.id, vehicleIds: [assignedVehicleId] },
          cancelUnderLock,
        );
      }
      return await cancelUnderLock();
    } catch (e) {
      console.error('Error cancelling booking:', e);
      return NextResponse.json({ error: 'Failed to cancel booking' }, { status: 500 });
    }
  });

  if (response.ok) {
    await withdrawApproval(tenantId, 'rental_booking', params.id, 'Booking cancelled');
  }
  return response;
}
