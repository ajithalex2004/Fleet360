export const dynamic = 'force-dynamic';

import { NextRequest, NextResponse } from 'next/server';
import { Prisma } from '@prisma/client';
import { requireAuthorizedTenant, stripTenantOwnershipFields } from '@/lib/tenant-context';
import { prisma } from '@/lib/prisma';
import { withTenantRls } from '@/lib/rls';
import {
  computeSafePostRentalVehicleStatus,
  withRentalLock,
  withSavepoint,
} from '@/lib/rental/locks';
import { requireRentalPermission } from '@/lib/rental/rbac';
import { isRentalSecurityError } from '@/lib/rental/security-guards';
import {
  resolveInputFuelPct,
  resolveStoredOdometerKm,
} from '@/lib/rental/fuel-odometer';

function coerceCanonicalAgreementFuel(
  fuelPct: number | null,
): string | number | null {
  if (fuelPct == null) return null;
  const fuelField = Prisma.dmmf?.datamodel?.models
    ?.find((m) => m.name === 'RentalAgreement')
    ?.fields?.find((f) => f.name === 'fuelIn');
  if (fuelField?.type === 'Int' || fuelField?.type === 'Float' || fuelField?.type === 'Decimal') {
    return fuelPct;
  }
  return String(fuelPct);
}

// POST /api/rental/bookings/[id]/complete
// Closes/completes a booking on vehicle return, records post-rental ('checkout') inspection,
// syncs return_odometer / return_fuel_level, and releases vehicle back to AVAILABLE.
export async function POST(req: NextRequest, props: { params: Promise<{ id: string }> }) {
  const params = await props.params;

  const authz = requireAuthorizedTenant(req);
  if (!authz.ok) {
    return NextResponse.json({ error: authz.error }, { status: authz.status });
  }
  const { tenantId } = authz;

  const permErr = await requireRentalPermission(
    req.headers,
    tenantId,
    'edit',
    'bookings',
    req.nextUrl.pathname,
  );
  if (permErr) return permErr;

  const actorUserId = (req.headers.get('x-user-id') ?? '').trim() || 'staff';

  return withTenantRls(prisma, tenantId, async (tx) => {
    try {
      const bodyRaw = await req.json().catch(() => ({}));
      const body = stripTenantOwnershipFields(
        (bodyRaw && typeof bodyRaw === 'object' ? bodyRaw : {}) as Record<string, unknown>,
      ) as Record<string, any>;

      const rawMileageInput =
        body.mileageIn ?? body.returnOdometer ?? body.odometerReading ?? body.mileage;
      if (rawMileageInput != null && rawMileageInput !== '') {
        const m = Number(rawMileageInput);
        if (!Number.isFinite(m) || m < 0) {
          return NextResponse.json({ error: 'Invalid mileage reading' }, { status: 400 });
        }
      }

      if (body.estimatedDamageCost != null && body.estimatedDamageCost !== '') {
        const dmg = Number(body.estimatedDamageCost);
        if (!Number.isFinite(dmg) || dmg < 0) {
          return NextResponse.json({ error: 'Invalid estimatedDamageCost' }, { status: 400 });
        }
      }

      const booking = await tx.rentalBooking.findFirst({
        where: { id: params.id, tenantId, deletedAt: null },
        include: { agreement: true },
      });
      if (!booking) return NextResponse.json({ error: 'Booking not found' }, { status: 404 });
      if (booking.status !== 'ACTIVE') {
        return NextResponse.json(
          { error: `Cannot complete a booking in status: ${booking.status}` },
          { status: 409 },
        );
      }

      const parsedMileage =
        rawMileageInput != null && rawMileageInput !== '' ? Number(rawMileageInput) : Number.NaN;
      const mileageInt = Number.isFinite(parsedMileage) ? Math.round(parsedMileage) : null;

      let storedPickupOdo = resolveStoredOdometerKm(booking.agreement?.mileageOut);
      if (booking.agreement?.id && typeof (tx as any).$queryRawUnsafe === 'function') {
        const odoRows = await withSavepoint<
          Array<{ pickup_odometer: number | null; mileage_out: number | null }>
        >(
          tx,
          'complete_read_pickup_odo',
          () =>
            tx.$queryRawUnsafe(
              `SELECT pickup_odometer, mileage_out
                 FROM rental_agreements
                WHERE id::text = $1 AND tenant_id::text = $2
                LIMIT 1`,
              booking.agreement!.id,
              tenantId,
            ),
          [],
        );
        if (odoRows[0]) {
          storedPickupOdo = resolveStoredOdometerKm(
            odoRows[0].pickup_odometer,
            odoRows[0].mileage_out ?? booking.agreement.mileageOut,
          );
        }
      }

      if (mileageInt != null && storedPickupOdo != null && mileageInt < storedPickupOdo) {
        return NextResponse.json(
          { error: 'Return mileage cannot be lower than pickup mileage' },
          { status: 422 },
        );
      }

      const hasFuelInput =
        body.fuelLevel !== undefined ||
        body.fuelIn !== undefined ||
        body.returnFuelLevel !== undefined ||
        body.fuelInPct !== undefined ||
        body.returnFuelPct !== undefined;
      const returnFuelPct = hasFuelInput ? resolveInputFuelPct(body, 'return', 'PCT') : null;
      const agreementFuel = coerceCanonicalAgreementFuel(returnFuelPct);

      const vehicleIdToRelease = booking.vehicleId ?? booking.agreement?.vehicleId ?? null;

      const runUnderLock = async () => {
        const updatedBooking = await tx.rentalBooking.update({
          where: { id: params.id, tenantId },
          data: { status: 'COMPLETED', updatedAt: new Date() },
        });

        // Record return inspection ('checkout' = Post-Rental Return); canonical 0-100% fuel
        if (mileageInt != null || returnFuelPct != null || body.damages !== undefined || body.notes !== undefined) {
          await tx.vehicleInspection.create({
            data: {
              tenantId,
              bookingId: params.id,
              type: 'checkout',
              mileage: mileageInt,
              fuelLevel: returnFuelPct,
              damages: typeof body.damages === 'string' ? body.damages : null,
              inspector: actorUserId,
              notes: typeof body.notes === 'string' ? body.notes : null,
            },
          });
        }

        // Update agreement status and return odometer/fuel
        if (booking.agreement) {
          const updateData: Record<string, unknown> = { status: 'COMPLETED' };
          if (mileageInt != null) updateData.mileageIn = mileageInt;
          if (agreementFuel != null) {
            updateData.fuelIn = agreementFuel;
          }
          await tx.rentalAgreement.update({
            where: { id: booking.agreement.id, tenantId },
            data: updateData as any,
          });

          if (mileageInt != null || returnFuelPct != null) {
            await withSavepoint(
              tx,
              'complete_sync_agr_cols',
              () =>
                tx.$executeRawUnsafe(
                  `UPDATE rental_agreements
                      SET return_odometer = COALESCE($1, return_odometer),
                          mileage_in = COALESCE($1, mileage_in),
                          return_fuel_level = COALESCE($2, return_fuel_level)
                    WHERE id::text = $3
                      AND tenant_id::text = $4`,
                  mileageInt,
                  returnFuelPct,
                  booking.agreement!.id,
                  tenantId,
                ),
              0,
            );
          }
        }

        // Create damage claims if reported
        if (body.damages && body.estimatedDamageCost != null && Number(body.estimatedDamageCost) > 0) {
          await tx.damageClaim.create({
            data: {
              tenantId,
              bookingId: params.id,
              description: String(body.damages),
              estimatedCost: Number(body.estimatedDamageCost),
              status: 'OPEN',
              insuranceClaim: Boolean(body.insuranceClaim),
            },
          });
        }

        // Safely transition physical vehicle status via computeSafePostRentalVehicleStatus
        // (preserves GROUNDED/MAINTENANCE, open WorkOrders, active leases, other active agreements, or 24h reservations)
        if (vehicleIdToRelease) {
          await withSavepoint(
            tx,
            'complete_release_vehicle',
            async () => {
              if (typeof (tx as any).$queryRawUnsafe === 'function') {
                const { status: safeStatus } = await computeSafePostRentalVehicleStatus(tx, {
                  tenantId,
                  vehicleId: vehicleIdToRelease,
                  excludeAgreementId: booking.agreement?.id ?? null,
                  excludeBookingId: booking.id,
                });
                if (typeof tx.vehicle?.updateMany === 'function') {
                  await tx.vehicle.updateMany({
                    where: {
                      id: vehicleIdToRelease,
                      tenantId,
                      status: { in: ['RENTED', 'RESERVED'] },
                    },
                    data: { status: safeStatus },
                  });
                } else if (typeof (tx as any).$executeRawUnsafe === 'function') {
                  await tx.$executeRawUnsafe(
                    `UPDATE vehicles
                        SET status = $3
                      WHERE id = $1
                        AND tenant_id::text = $2
                        AND status IN ('RENTED', 'RESERVED')`,
                    vehicleIdToRelease,
                    tenantId,
                    safeStatus,
                  );
                }
              } else {
                const otherActive =
                  typeof tx.rentalAgreement?.count === 'function'
                    ? await tx.rentalAgreement.count({
                        where: {
                          tenantId,
                          vehicleId: vehicleIdToRelease,
                          status: 'ACTIVE',
                          ...(booking.agreement?.id ? { id: { not: booking.agreement.id } } : {}),
                        },
                      })
                    : 0;
                if (otherActive === 0 && typeof tx.vehicle?.updateMany === 'function') {
                  await tx.vehicle.updateMany({
                    where: {
                      id: vehicleIdToRelease,
                      tenantId,
                      status: { in: ['RENTED', 'RESERVED'] },
                    },
                    data: { status: 'AVAILABLE' },
                  });
                }
              }
            },
            undefined,
          );
        }

        return NextResponse.json({ booking: updatedBooking });
      };

      if (typeof (tx as any).$executeRawUnsafe === 'function') {
        return await withRentalLock(
          tx,
          tenantId,
          { entityKey: params.id, vehicleIds: [vehicleIdToRelease] },
          runUnderLock,
        );
      }

      return await runUnderLock();
    } catch (e) {
      if (isRentalSecurityError(e)) {
        return NextResponse.json({ error: e.message, code: e.code }, { status: e.status });
      }
      console.error('Error completing booking:', e);
      return NextResponse.json({ error: 'Failed to complete booking' }, { status: 500 });
    }
  });
}
