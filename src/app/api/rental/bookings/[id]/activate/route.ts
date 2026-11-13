export const dynamic = 'force-dynamic';

import { NextRequest, NextResponse } from 'next/server';
import { requireAuthorizedTenant, stripTenantOwnershipFields } from '@/lib/tenant-context';
import { Prisma } from '@prisma/client';
import { prisma } from '@/lib/prisma';
import { withTenantRls } from '@/lib/rls';
import { sendBookingActivatedWhatsApp } from '@/lib/whatsapp';
import {
  withRentalLock,
  nextRentalSerial,
  checkVehicleRentalConflict,
  computeSafePostRentalVehicleStatus,
  withSavepoint,
} from '@/lib/rental/locks';
import { hasRentalPermission, requireRentalPermission } from '@/lib/rental/rbac';
import {
  assertCustomerEligibleForRental,
  assertRentalForeignKeysInTenant,
  isRentalSecurityError,
} from '@/lib/rental/security-guards';
import {
  dispatchUaeRegulatoryReportOutsideRls,
  queueUaeRegulatoryReportInTx,
  type UaeRegulatoryReportRecord,
} from '@/lib/rental/uae-regulatory-reporting';
import { resolveInputFuelPct } from '@/lib/rental/fuel-odometer';
import { recordRacSecurityDepositCollected } from '@/lib/finance/rac-gl-posting';

function coerceCanonicalAgreementFuel(
  fuelPct: number | null,
): string | number | null {
  if (fuelPct == null) return null;
  const fuelField = Prisma.dmmf?.datamodel?.models
    ?.find((m) => m.name === 'RentalAgreement')
    ?.fields?.find((f) => f.name === 'fuelOut');
  if (fuelField?.type === 'Int' || fuelField?.type === 'Float' || fuelField?.type === 'Decimal') {
    return fuelPct;
  }
  return String(fuelPct);
}

// POST /api/rental/bookings/[id]/activate
// Activates booking (vehicle handed over to customer), records pick-up ('checkin') inspection,
// ensures a RentalAgreement exists and is ACTIVE, syncs pickup odometer/fuel, and marks vehicle RENTED.
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

  const allowCreditOverride = await hasRentalPermission(
    req.headers,
    tenantId,
    'approve',
    'customers',
  );
  const actorUserId = (req.headers.get('x-user-id') ?? '').trim() || 'staff';

  try {
    const bodyRaw = await req.json().catch(() => ({}));
    const body = stripTenantOwnershipFields(
      (bodyRaw && typeof bodyRaw === 'object' ? bodyRaw : {}) as Record<string, unknown>,
    ) as Record<string, any>;

    const rawMileageInput =
      body.mileageOut ?? body.pickupOdometer ?? body.odometerReading ?? body.mileage;
    if (rawMileageInput != null && rawMileageInput !== '') {
      const m = Number(rawMileageInput);
      if (!Number.isFinite(m) || m < 0) {
        return NextResponse.json({ error: 'Invalid mileage reading' }, { status: 400 });
      }
    }

    if (body.securityDeposit != null && body.securityDeposit !== '') {
      const dep = Number(body.securityDeposit);
      if (!Number.isFinite(dep) || dep < 0) {
        return NextResponse.json({ error: 'Invalid securityDeposit' }, { status: 400 });
      }
    }

    const txOutcome = await withTenantRls(prisma, tenantId, async (tx) => {
      const booking = await tx.rentalBooking.findFirst({
        where: { id: params.id, tenantId, deletedAt: null },
        include: { agreement: true, customer: true },
      });
      if (!booking) {
        return { error: 'Booking not found', status: 404 as const };
      }
      const normalizedBookingStatus = String(booking.status ?? '').toUpperCase();
      if (normalizedBookingStatus === 'PENDING') {
        return {
          error: 'Booking must be confirmed before activation',
          code: 'BOOKING_NOT_CONFIRMED',
          status: 422 as const,
        };
      }
      if (normalizedBookingStatus !== 'CONFIRMED') {
        return {
          error: `Cannot activate a booking in status: ${booking.status}`,
          status: 409 as const,
        };
      }

      const parsedMileage =
        rawMileageInput != null && rawMileageInput !== '' ? Number(rawMileageInput) : Number.NaN;
      const mileageInt = Number.isFinite(parsedMileage) ? Math.round(parsedMileage) : null;

      const hasFuelInput =
        body.fuelLevel !== undefined ||
        body.fuelOut !== undefined ||
        body.pickupFuelLevel !== undefined ||
        body.fuelOutPct !== undefined ||
        body.pickupFuelPct !== undefined;
      const pickupFuelPct = hasFuelInput ? resolveInputFuelPct(body, 'pickup', 'PCT') : null;
      const agreementFuel = coerceCanonicalAgreementFuel(pickupFuelPct);

      const targetVehicleId =
        (typeof body.vehicleId === 'string' && body.vehicleId.trim()
          ? body.vehicleId.trim()
          : null) ??
        booking.vehicleId ??
        booking.agreement?.vehicleId ??
        null;

      if (!targetVehicleId) {
        return {
          error: 'Assign a specific vehicle plate before activating rental',
          code: 'VEHICLE_REQUIRED',
          status: 422 as const,
        };
      }

      // Verify customer and assigned vehicle belong strictly to this tenant
      await assertRentalForeignKeysInTenant(tx, tenantId, {
        customerId: booking.customerId,
        vehicleId: targetVehicleId,
      });

      await assertCustomerEligibleForRental(tx, {
        tenantId,
        customerId: booking.customerId,
        dropoffDate: booking.dropoffDate,
        vehicleCategory: booking.vehicleCategory,
        additionalExposureAed: Number(booking.totalAmount ?? 0),
        excludeBookingId: booking.id,
        allowCreditOverride,
        requireLicenseOnFile: true,
      });

      const runUnderLock = async () => {
        if (targetVehicleId && typeof (tx as any).$queryRawUnsafe === 'function') {
          const vehRows = await withSavepoint<Array<{ status: string | null }>>(
            tx,
            'activate_chk_veh_status',
            () =>
              tx.$queryRawUnsafe<Array<{ status: string | null }>>(
                `SELECT status::text AS status
                   FROM vehicles
                  WHERE id = $1 AND tenant_id::text = $2
                  LIMIT 1`,
                targetVehicleId,
                tenantId,
              ),
            [],
          );
          const vehStatus = String(vehRows[0]?.status ?? '').toUpperCase();
          if (['GROUNDED', 'MAINTENANCE', 'INACTIVE'].includes(vehStatus)) {
            return {
              error: `Cannot dispatch vehicle in ${vehStatus} status`,
              status: 409 as const,
            };
          }

          const conflict = await checkVehicleRentalConflict(tx, {
            tenantId,
            vehicleId: targetVehicleId,
            startDate: booking.pickupDate,
            endDate: booking.dropoffDate,
            excludeBookingId: booking.id,
            excludeAgreementId: booking.agreement?.id ?? null,
            checkGrounding: true,
          });
          if (conflict.hasConflict) {
            return {
              error:
                conflict.reason ??
                'Vehicle has a conflicting reservation or active rental agreement',
              conflictingRef: conflict.conflictingRef,
              status: 409 as const,
            };
          }
        }

        const updatedBooking = await tx.rentalBooking.update({
          where: { id: params.id, tenantId },
          data: {
            status: 'ACTIVE',
            ...(targetVehicleId && targetVehicleId !== booking.vehicleId
              ? { vehicleId: targetVehicleId }
              : {}),
            updatedAt: new Date(),
          },
        });

        // Record pick-up baseline inspection ('checkin' = Pre-Rental Pick-Up); canonical 0-100% fuel
        if (mileageInt != null || pickupFuelPct != null || body.damages !== undefined || body.notes !== undefined) {
          await tx.vehicleInspection.create({
            data: {
              tenantId,
              bookingId: params.id,
              type: 'checkin',
              mileage: mileageInt,
              fuelLevel: pickupFuelPct,
              damages: typeof body.damages === 'string' ? body.damages : null,
              inspector: actorUserId,
              notes: typeof body.notes === 'string' ? body.notes : null,
            },
          });
        }

        const signedAtVal = new Date();
        // Audit signer is strictly the authenticated staff actor; customer signer label goes in remarks
        const customerSignerNote =
          typeof body.signedBy === 'string' && body.signedBy.trim()
            ? `[Customer Signer: ${body.signedBy.trim().slice(0, 120)}]`
            : null;
        const explicitSecurityDeposit =
          body.securityDeposit != null && body.securityDeposit !== ''
            ? Math.round(Number(body.securityDeposit) * 100) / 100
            : undefined;
        let agreement: any = null;

        if (booking.agreement) {
          const nextRemarks = customerSignerNote
            ? booking.agreement.remarks
              ? `${booking.agreement.remarks}\n${customerSignerNote}`
              : customerSignerNote
            : booking.agreement.remarks;
          agreement = await tx.rentalAgreement.update({
            where: { id: booking.agreement.id, tenantId },
            data: {
              ...(targetVehicleId ? { vehicleId: targetVehicleId } : {}),
              ...(mileageInt != null ? { mileageOut: mileageInt } : {}),
              ...(agreementFuel != null ? { fuelOut: agreementFuel as any } : {}),
              ...(explicitSecurityDeposit !== undefined
                ? { securityDeposit: explicitSecurityDeposit }
                : {}),
              status: 'ACTIVE',
              signedAt: signedAtVal,
              signedBy: actorUserId,
              ...(nextRemarks !== undefined ? { remarks: nextRemarks } : {}),
            },
          });
        } else {
          // Auto-create RentalAgreement so an ACTIVE booking is never stranded with agreement = null
          const agreementNo =
            typeof (tx as any).$executeRawUnsafe === 'function'
              ? await nextRentalSerial(tx, {
                  tenantId,
                  series: 'RA',
                  prefix: 'RA-',
                  table: 'rental_agreements',
                  column: 'agreement_no',
                  padWidth: 6,
                })
              : `RA-${String(
                  ((typeof tx.rentalAgreement?.count === 'function'
                    ? await tx.rentalAgreement.count({ where: { tenantId } })
                    : 0) + 1),
                ).padStart(6, '0')}`;

          if (typeof tx.rentalAgreement?.create === 'function') {
            agreement = await tx.rentalAgreement.create({
              data: {
                tenantId,
                agreementNo,
                bookingId: booking.id,
                customerId: booking.customerId,
                vehicleId: targetVehicleId,
                startDate: booking.pickupDate,
                endDate: booking.dropoffDate,
                openBranchId: booking.pickupLocation ?? null,
                closeBranchId: booking.dropoffLocation ?? null,
                dailyRate: booking.dailyRate ?? 0,
                totalAmount: booking.totalAmount ?? 0,
                ...(explicitSecurityDeposit !== undefined
                  ? { securityDeposit: explicitSecurityDeposit }
                  : {}),
                currency: booking.currency ?? 'AED',
                mileageOut: mileageInt,
                fuelOut: agreementFuel as any,
                status: 'ACTIVE',
                signedAt: signedAtVal,
                signedBy: actorUserId,
                ...(customerSignerNote ? { remarks: customerSignerNote } : {}),
              },
            });
          }
        }

        // Sync SQL columns pickup_odometer / mileage_out / pickup_fuel_level on rental_agreements
        if (agreement?.id && (mileageInt != null || pickupFuelPct != null)) {
          await withSavepoint(
            tx,
            'activate_sync_agr_cols',
            () =>
              tx.$executeRawUnsafe(
                `UPDATE rental_agreements
                    SET pickup_odometer = COALESCE($1, pickup_odometer),
                        mileage_out = COALESCE($1, mileage_out),
                        pickup_fuel_level = COALESCE($2, pickup_fuel_level)
                  WHERE id::text = $3
                    AND tenant_id::text = $4`,
                mileageInt,
                pickupFuelPct,
                agreement.id,
                tenantId,
              ),
            0,
          );
        }

        // Safely release previous RESERVED vehicle if vehicle was swapped at activation
        const priorVehicleId = booking.vehicleId ?? booking.agreement?.vehicleId ?? null;
        if (priorVehicleId && targetVehicleId && priorVehicleId !== targetVehicleId) {
          await withSavepoint(
            tx,
            'activate_release_prior_veh',
            async () => {
              if (typeof (tx as any).$queryRawUnsafe === 'function' && typeof tx.vehicle?.updateMany === 'function') {
                const { status: safeOldStatus } = await computeSafePostRentalVehicleStatus(tx, {
                  tenantId,
                  vehicleId: priorVehicleId,
                  excludeAgreementId: agreement?.id ?? null,
                  excludeBookingId: booking.id,
                });
                await tx.vehicle.updateMany({
                  where: { id: priorVehicleId, tenantId, status: { in: ['RESERVED', 'RENTED'] } },
                  data: { status: safeOldStatus },
                });
              }
            },
            undefined,
          );
        }

        // Transition physical vehicle to status = 'RENTED' (strictly scoped to tenantId)
        if (targetVehicleId) {
          await withSavepoint(
            tx,
            'activate_mark_vehicle_rented',
            async () => {
              if (typeof tx.vehicle?.updateMany === 'function') {
                await tx.vehicle.updateMany({
                  where: { id: targetVehicleId, tenantId },
                  data: {
                    status: 'RENTED',
                    ...(mileageInt != null ? { currentMileage: BigInt(mileageInt) } : {}),
                    ...(pickupFuelPct != null ? { fuelLevel: pickupFuelPct } : {}),
                  },
                });
              } else if (typeof (tx as any).$executeRawUnsafe === 'function') {
                await tx.$executeRawUnsafe(
                  `UPDATE vehicles SET status = 'RENTED' WHERE id = $1 AND tenant_id::text = $2`,
                  targetVehicleId,
                  tenantId,
                );
              }
            },
            undefined,
          );
        }

        // Link any pre-booked additional drivers to the activated agreement
        if (agreement?.id && typeof (tx as any).$executeRawUnsafe === 'function') {
          await withSavepoint(
            tx,
            'activate_link_add_drivers',
            () =>
              tx.$executeRawUnsafe(
                `UPDATE rental_additional_drivers
                    SET agreement_id = $1
                  WHERE booking_id = $2
                    AND tenant_id::text = $3
                    AND agreement_id IS NULL`,
                agreement.id,
                booking.id,
                tenantId,
              ),
            0,
          );
        }

        // Post RAC security deposit liability GL journal if cash/card deposit collected on handover
        const effectiveDeposit = Number(
          explicitSecurityDeposit ?? agreement?.securityDeposit ?? booking.agreement?.securityDeposit ?? 0,
        );
        const effectiveDepositStatus = String(
          body.depositStatus ?? (agreement as any)?.depositStatus ?? '',
        ).toUpperCase();
        if (agreement?.id && effectiveDeposit > 0 && effectiveDepositStatus === 'PAID') {
          await recordRacSecurityDepositCollected(tx, {
            tenantId,
            agreementId: agreement.id,
            agreementNo: agreement.agreementNo ?? null,
            customerName: booking.customer?.fullName ?? 'Rental Customer',
            branch: booking.pickupLocation ?? null,
            amount: effectiveDeposit,
            collectionMethod:
              typeof body.depositMethod === 'string'
                ? body.depositMethod
                : typeof body.paymentMethod === 'string'
                  ? body.paymentMethod
                  : 'CARD',
            currency: booking.currency ?? 'AED',
            preparedBy: actorUserId,
          });
        }

        // Queue UAE Tarrashud / ITC regulatory manifest inside transaction
        let regulatoryReport: UaeRegulatoryReportRecord | null = null;
        if (agreement?.id && typeof (tx as any).$queryRawUnsafe === 'function') {
          regulatoryReport = await withSavepoint<UaeRegulatoryReportRecord | null>(
            tx,
            'activate_reg_report',
            () =>
              queueUaeRegulatoryReportInTx(tx, {
                tenantId,
                agreementId: agreement.id,
                eventType: 'HANDOVER',
                submittedBy: actorUserId,
              }),
            null,
          );
        }

        return { updatedBooking, agreement, booking, regulatoryReport };
      };

      if (typeof (tx as any).$executeRawUnsafe === 'function') {
        return await withRentalLock(
          tx,
          tenantId,
          {
            entityKey: params.id,
            vehicleIds: [booking.vehicleId, booking.agreement?.vehicleId, targetVehicleId],
          },
          runUnderLock,
        );
      }

      return await runUnderLock();
    });

    if ('error' in txOutcome && txOutcome.error !== undefined) {
      return NextResponse.json(
        {
          error: txOutcome.error,
          ...('code' in txOutcome && txOutcome.code ? { code: txOutcome.code } : {}),
          ...('conflictingRef' in txOutcome && txOutcome.conflictingRef
            ? { conflictingRef: txOutcome.conflictingRef }
            : {}),
        },
        { status: txOutcome.status },
      );
    }

    // Post-commit external regulatory dispatch (strictly OUTSIDE `withTenantRls`)
    let finalRegReport = txOutcome.regulatoryReport;
    if (finalRegReport?.status === 'QUEUED') {
      try {
        finalRegReport = await dispatchUaeRegulatoryReportOutsideRls(finalRegReport);
      } catch (regErr) {
        console.warn('[activate booking] regulatory dispatch warning:', regErr);
      }
    }

    // Best-effort WhatsApp activation message after transaction commits
    if (txOutcome.booking.customer) {
      void sendBookingActivatedWhatsApp(
        {
          fullName: txOutcome.booking.customer.fullName,
          phone: txOutcome.booking.customer.phone,
        },
        {
          bookingRef: txOutcome.booking.bookingRef,
          pickupDate: txOutcome.booking.pickupDate,
          dropoffDate: txOutcome.booking.dropoffDate,
          pickupLocation: txOutcome.booking.pickupLocation,
          dropoffLocation: txOutcome.booking.dropoffLocation,
          vehicleCategory: txOutcome.booking.vehicleCategory,
          totalAmount: txOutcome.booking.totalAmount
            ? Number(txOutcome.booking.totalAmount)
            : null,
          currency: txOutcome.booking.currency ?? 'AED',
        },
      );
    }

    return NextResponse.json({
      booking: txOutcome.updatedBooking,
      agreement: txOutcome.agreement,
      regulatoryReport: finalRegReport,
    });
  } catch (e) {
    if (isRentalSecurityError(e)) {
      return NextResponse.json({ error: e.message, code: e.code }, { status: e.status });
    }
    console.error('Error activating booking:', e);
    return NextResponse.json({ error: 'Failed to activate booking' }, { status: 500 });
  }
}
