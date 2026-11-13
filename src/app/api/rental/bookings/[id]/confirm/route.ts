export const dynamic = 'force-dynamic';

import { NextRequest, NextResponse } from 'next/server';
import { requireAuthorizedTenant, stripTenantOwnershipFields } from '@/lib/tenant-context';
import { prisma } from '@/lib/prisma';
import { withTenantRls } from '@/lib/rls';
import { sendBookingConfirmedWhatsApp } from '@/lib/whatsapp';
import { requireApproved } from '@/lib/workflow/approvals';
import { hasRentalPermission, requireRentalPermission } from '@/lib/rental/rbac';
import {
  checkVehicleRentalConflict,
  computeSafePostRentalVehicleStatus,
  nextRentalSerial,
  withRentalLock,
  withSavepoint,
} from '@/lib/rental/locks';
import {
  assertCustomerEligibleForRental,
  assertRentalForeignKeysInTenant,
  isRentalSecurityError,
} from '@/lib/rental/security-guards';

// POST /api/rental/bookings/[id]/confirm
// Confirms a PENDING booking and generates a RentalAgreement
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
    'approve',
    'bookings',
    req.nextUrl.pathname,
  );
  if (permErr) return permErr;

  // With a Booking Approval workflow, only an approved booking is confirmed.
  const gate = await requireApproved({
    headers: req.headers,
    tenantId,
    referenceType: 'rental_booking',
    referenceId: params.id,
  });
  if (gate) return gate;

  const allowCreditOverride = await hasRentalPermission(
    req.headers,
    tenantId,
    'approve',
    'customers',
  );

  try {
    const bodyRaw = await req.json().catch(() => ({}));
    const body = stripTenantOwnershipFields(
      (bodyRaw && typeof bodyRaw === 'object' ? bodyRaw : {}) as Record<string, unknown>,
    ) as Record<string, unknown>;

    let securityDeposit: number | null = null;
    if (body.securityDeposit !== undefined && body.securityDeposit !== null && body.securityDeposit !== '') {
      const parsedDep = Number(body.securityDeposit);
      if (!Number.isFinite(parsedDep) || parsedDep < 0) {
        return NextResponse.json({ error: 'Invalid securityDeposit' }, { status: 400 });
      }
      securityDeposit = Math.round(parsedDep * 100) / 100;
    }

    const requestedVehicleId =
      typeof body.vehicleId === 'string' && body.vehicleId.trim()
        ? body.vehicleId.trim()
        : null;

    const txOutcome = await withTenantRls(prisma, tenantId, async (tx) => {
      const booking = await tx.rentalBooking.findFirst({
        where: { id: params.id, tenantId, deletedAt: null },
        include: { customer: true, agreement: true },
      });
      if (!booking) {
        return { error: 'Booking not found', status: 404 as const };
      }
      if (booking.status !== 'PENDING') {
        return {
          error: `Cannot confirm a booking in status: ${booking.status}`,
          status: 409 as const,
        };
      }

      const targetVehicleId = requestedVehicleId ?? booking.vehicleId ?? null;

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
      });

      const confirmUnderLock = async () => {
        if (targetVehicleId && typeof (tx as { $queryRawUnsafe?: unknown }).$queryRawUnsafe === 'function') {
          const vehRows = await withSavepoint<Array<{ status: string | null; is_active: boolean | null }>>(
            tx,
            'confirm_chk_veh_status',
            () =>
              tx.$queryRawUnsafe(
                `SELECT status::text AS status, is_active
                   FROM vehicles
                  WHERE id = $1 AND tenant_id::text = $2
                  LIMIT 1`,
                targetVehicleId,
                tenantId,
              ),
            [],
          );
          const vehStatus = String(vehRows[0]?.status ?? '').toUpperCase();
          if (
            vehRows[0]?.is_active === false ||
            ['GROUNDED', 'MAINTENANCE', 'OUT_OF_SERVICE', 'INACTIVE', 'DISPOSED', 'SOLD'].includes(
              vehStatus,
            )
          ) {
            return {
              error: `Cannot assign vehicle in ${vehStatus || 'INACTIVE'} status`,
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
              error: conflict.reason ?? 'Vehicle has a conflicting reservation',
              status: 409 as const,
            };
          }
        }

        const updatedBooking = await tx.rentalBooking.update({
          where: { id: params.id, tenantId },
          data: {
            status: 'CONFIRMED',
            ...(targetVehicleId !== booking.vehicleId ? { vehicleId: targetVehicleId } : {}),
            updatedAt: new Date(),
          },
        });

        let agreement = booking.agreement;
        if (!agreement) {
          const agreementNo =
            typeof (tx as { $executeRawUnsafe?: unknown }).$executeRawUnsafe === 'function'
              ? await nextRentalSerial(tx, {
                  tenantId,
                  series: 'RA',
                  prefix: 'RA-',
                  table: 'rental_agreements',
                  column: 'agreement_no',
                  padWidth: 6,
                })
              : `RA-${String((await tx.rentalAgreement.count({ where: { tenantId } })) + 1).padStart(6, '0')}`;

          agreement = await tx.rentalAgreement.create({
            data: {
              tenantId,
              agreementNo,
              bookingId: params.id,
              customerId: booking.customerId,
              vehicleId: targetVehicleId,
              startDate: booking.pickupDate,
              endDate: booking.dropoffDate,
              dailyRate: booking.dailyRate,
              totalAmount: booking.totalAmount,
              securityDeposit,
              status: 'DRAFT',
            },
          });
        } else if (targetVehicleId !== agreement.vehicleId) {
          agreement = await tx.rentalAgreement.update({
            where: { id: agreement.id, tenantId },
            data: { vehicleId: targetVehicleId, updatedAt: new Date() },
          });
        }

        // Release prior vehicle if changed during confirm
        if (booking.vehicleId && booking.vehicleId !== targetVehicleId) {
          await withSavepoint(
            tx,
            'confirm_release_old_vehicle',
            async () => {
              if (
                typeof (tx as { $queryRawUnsafe?: unknown }).$queryRawUnsafe === 'function' &&
                typeof tx.vehicle?.updateMany === 'function'
              ) {
                const { status: safeOldStatus } = await computeSafePostRentalVehicleStatus(tx, {
                  tenantId,
                  vehicleId: booking.vehicleId!,
                  excludeAgreementId: agreement?.id ?? null,
                  excludeBookingId: booking.id,
                });
                await tx.vehicle.updateMany({
                  where: { id: booking.vehicleId!, tenantId, status: 'RESERVED' },
                  data: { status: safeOldStatus },
                });
              }
            },
            undefined,
          );
        }

        // Reserve physical vehicle when currently AVAILABLE (never clobber an active 'RENTED' vehicle)
        if (targetVehicleId) {
          await withSavepoint(
            tx,
            'confirm_reserve_vehicle',
            async () => {
              if (typeof tx.vehicle?.updateMany === 'function') {
                await tx.vehicle.updateMany({
                  where: { id: targetVehicleId, tenantId, status: 'AVAILABLE' },
                  data: { status: 'RESERVED' },
                });
              }
            },
            undefined,
          );
        }

        return { updatedBooking, agreement, customer: booking.customer };
      };

      if (typeof (tx as { $executeRawUnsafe?: unknown }).$executeRawUnsafe === 'function') {
        return withRentalLock(
          tx,
          tenantId,
          { entityKey: booking.id, vehicleIds: [booking.vehicleId, targetVehicleId] },
          confirmUnderLock,
        );
      }
      return confirmUnderLock();
    });

    if ('error' in txOutcome && txOutcome.error !== undefined) {
      return NextResponse.json({ error: txOutcome.error }, { status: txOutcome.status });
    }

    // Best-effort WhatsApp confirmation after transaction commits
    if (txOutcome.customer) {
      void sendBookingConfirmedWhatsApp(
        { fullName: txOutcome.customer.fullName, phone: txOutcome.customer.phone },
        {
          bookingRef: txOutcome.updatedBooking.bookingRef,
          pickupDate: txOutcome.updatedBooking.pickupDate,
          dropoffDate: txOutcome.updatedBooking.dropoffDate,
          pickupLocation: txOutcome.updatedBooking.pickupLocation,
          dropoffLocation: txOutcome.updatedBooking.dropoffLocation,
          vehicleCategory: txOutcome.updatedBooking.vehicleCategory,
          totalAmount: txOutcome.updatedBooking.totalAmount
            ? Number(txOutcome.updatedBooking.totalAmount)
            : null,
          currency: txOutcome.updatedBooking.currency ?? 'AED',
        },
      );
    }

    return NextResponse.json({
      booking: txOutcome.updatedBooking,
      agreement: txOutcome.agreement,
    });
  } catch (e) {
    if (isRentalSecurityError(e)) {
      return NextResponse.json({ error: e.message, code: e.code }, { status: e.status });
    }
    console.error('Error confirming booking:', e);
    return NextResponse.json({ error: 'Failed to confirm booking' }, { status: 500 });
  }
}
