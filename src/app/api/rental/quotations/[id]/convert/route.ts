export const dynamic = 'force-dynamic';

/**
 * POST /api/rental/quotations/[id]/convert
 * Atomically converts an eligible RentalQuotation (DRAFT / SENT / ACCEPTED) into a RentalBooking
 * (and optional DRAFT RentalAgreement), matching or creating the tenant RentalCustomer,
 * checking vehicle availability under `withRentalLock`, and stamping `status = 'CONVERTED'`
 * + `converted_to` on `rental_quotations` (and linked `rental_inquiries` if present).
 */

import { NextRequest, NextResponse } from 'next/server';
import { requireAuthorizedTenant, stripTenantOwnershipFields } from '@/lib/tenant-context';
import { withTenantRls } from '@/lib/rls';
import { prisma } from '@/lib/prisma';
import { hasRentalPermission, requireRentalPermission } from '@/lib/rental/rbac';
import {
  checkVehicleRentalConflict,
  nextRentalSerial,
  withRentalLock,
  withSavepoint,
} from '@/lib/rental/locks';
import {
  assertCustomerEligibleForRental,
  assertRentalForeignKeysInTenant,
  isRentalSecurityError,
} from '@/lib/rental/security-guards';

type Row = Record<string, unknown>;

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

function parseDateOrNull(v: unknown): Date | null {
  if (!v) return null;
  if (v instanceof Date) return Number.isNaN(v.getTime()) ? null : v;
  const s = String(v).trim();
  if (!s) return null;
  const d = new Date(/^\d{4}-\d{2}-\d{2}$/.test(s) ? `${s}T00:00:00Z` : s);
  return Number.isNaN(d.getTime()) ? null : d;
}

export async function POST(req: NextRequest, props: { params: Promise<{ id: string }> }) {
  const params = await props.params;
  const quoteId = params.id?.trim();

  const authz = requireAuthorizedTenant(req);
  if (!authz.ok) {
    return NextResponse.json({ error: authz.error }, { status: authz.status });
  }
  const { tenantId } = authz;

  if (!quoteId) {
    return NextResponse.json({ error: 'Quotation ID is required' }, { status: 400 });
  }

  const createBookingDenied = await requireRentalPermission(
    req.headers,
    tenantId,
    'create',
    'bookings',
    req.nextUrl.pathname,
  );
  if (createBookingDenied) return createBookingDenied;

  try {
    const bodyRaw = await req.json().catch(() => ({}));
    const body = stripTenantOwnershipFields(
      (bodyRaw && typeof bodyRaw === 'object' ? bodyRaw : {}) as Record<string, unknown>,
    ) as Record<string, unknown>;

    const confirmImmediately = body.confirmImmediately === true;
    if (confirmImmediately) {
      const confirmPermErr = await requireRentalPermission(
        req.headers,
        tenantId,
        'approve',
        'bookings',
        req.nextUrl.pathname,
      );
      if (confirmPermErr) return confirmPermErr;
    }

    const canOverrideExpiredQuote = await hasRentalPermission(
      req.headers,
      tenantId,
      'approve',
      'rates',
    );
    const allowCreditOverride = await hasRentalPermission(
      req.headers,
      tenantId,
      'approve',
      'customers',
    );

    const outcome = await withTenantRls(prisma, tenantId, async (tx) => {
      const qtRows = await tx.$queryRawUnsafe<Row[]>(
        `SELECT *
           FROM rental_quotations
          WHERE id::text = $1
            AND tenant_id::text = $2
            AND deleted_at IS NULL
          LIMIT 1`,
        quoteId,
        tenantId,
      );
      const quotation = qtRows[0];
      if (!quotation) {
        return { kind: 'err' as const, status: 404, error: 'Quotation not found' };
      }

      const currentStatus = String(quotation.status ?? 'DRAFT').toUpperCase();
      if (currentStatus === 'CONVERTED') {
        return {
          kind: 'err' as const,
          status: 409,
          error: `Quotation ${quotation.quote_no ?? quoteId} has already been converted (${quotation.converted_to ?? 'completed'})`,
        };
      }
      if (currentStatus === 'REJECTED' || currentStatus === 'CANCELLED') {
        return {
          kind: 'err' as const,
          status: 409,
          error: `Cannot convert a ${currentStatus} quotation`,
        };
      }
      if (currentStatus === 'EXPIRED' && !canOverrideExpiredQuote) {
        return {
          kind: 'err' as const,
          status: 409,
          error: 'Cannot convert an EXPIRED quotation without RAC Manager rate approval',
        };
      }

      const pickupDate =
        parseDateOrNull(body.pickupDate) ?? parseDateOrNull(quotation.pickup_date);
      const returnDate =
        parseDateOrNull(body.returnDate ?? body.dropoffDate) ??
        parseDateOrNull(quotation.return_date);

      if (!pickupDate || !returnDate || returnDate.getTime() < pickupDate.getTime()) {
        return {
          kind: 'err' as const,
          status: 400,
          error: 'Quotation is missing valid pickup and return dates',
        };
      }

      const rentalDays = Math.max(
        1,
        Number(quotation.rental_days ?? 0) ||
          Math.ceil((returnDate.getTime() - pickupDate.getTime()) / 86_400_000),
      );
      const dailyRate = round2(Math.max(0, Number(quotation.daily_rate ?? 0)));
      const grandTotal = round2(
        Math.max(
          0,
          Number(quotation.grand_total ?? 0) ||
            round2(dailyRate * rentalDays * 1.05),
        ),
      );
      const depositAmount = round2(Math.max(0, Number(quotation.deposit_amount ?? 0)));
      const vehicleCategory = (
        (typeof body.vehicleCategory === 'string' && body.vehicleCategory.trim()) ||
        (typeof quotation.vehicle_type === 'string' && quotation.vehicle_type.trim()) ||
        'ECONOMY'
      ).toUpperCase();

      const explicitCustomerId =
        typeof body.customerId === 'string' && body.customerId.trim()
          ? body.customerId.trim()
          : typeof quotation.customer_id === 'string' && quotation.customer_id.trim()
            ? quotation.customer_id.trim()
            : null;
      const resolvedVehicleId =
        typeof body.vehicleId === 'string' && body.vehicleId.trim()
          ? body.vehicleId.trim()
          : typeof quotation.vehicle_id === 'string' && quotation.vehicle_id.trim()
            ? quotation.vehicle_id.trim()
            : null;

      const customerName = String(quotation.customer_name ?? 'Quoted Customer').trim();
      const customerEmail =
        typeof quotation.email === 'string' && quotation.email.trim()
          ? quotation.email.trim()
          : null;
      const customerPhone =
        typeof quotation.phone === 'string' && quotation.phone.trim()
          ? quotation.phone.trim()
          : null;

      let customer = explicitCustomerId
        ? await tx.rentalCustomer.findFirst({
            where: { id: explicitCustomerId, tenantId, deletedAt: null },
          })
        : null;

      if (!customer && (customerEmail || customerPhone)) {
        customer = await tx.rentalCustomer.findFirst({
          where: {
            tenantId,
            deletedAt: null,
            OR: [
              ...(customerEmail ? [{ email: customerEmail }] : []),
              ...(customerPhone ? [{ phone: customerPhone }] : []),
            ],
          },
        });
      }

      if (!customer) {
        customer = await tx.rentalCustomer.create({
          data: {
            tenantId,
            fullName: customerName,
            email: customerEmail,
            phone: customerPhone ?? '0000000000',
            customerType: 'INDIVIDUAL',
          },
        });
      }

      await assertRentalForeignKeysInTenant(tx, tenantId, {
        customerId: customer.id,
        vehicleId: resolvedVehicleId,
      });

      await assertCustomerEligibleForRental(tx, {
        tenantId,
        customerId: customer.id,
        dropoffDate: returnDate,
        vehicleCategory,
        additionalExposureAed: grandTotal,
        allowCreditOverride,
      });

      return withRentalLock(
        tx,
        tenantId,
        { entityKey: quoteId, vehicleIds: [resolvedVehicleId] },
        async () => {
          if (resolvedVehicleId) {
            const vehRows = await withSavepoint<
              Array<{ status: string | null; is_active: boolean | null }>
            >(
              tx,
              'qt_convert_chk_veh',
              () =>
                tx.$queryRawUnsafe(
                  `SELECT status::text AS status, is_active
                     FROM vehicles
                    WHERE id = $1 AND tenant_id::text = $2
                    LIMIT 1`,
                  resolvedVehicleId,
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
                kind: 'err' as const,
                status: 409,
                error: `Selected vehicle is in ${vehStatus || 'INACTIVE'} status`,
              };
            }

            const conflict = await checkVehicleRentalConflict(tx, {
              tenantId,
              vehicleId: resolvedVehicleId,
              startDate: pickupDate,
              endDate: returnDate,
              checkGrounding: true,
            });
            if (conflict.hasConflict) {
              return {
                kind: 'err' as const,
                status: 409,
                error: conflict.reason ?? 'Selected vehicle has an overlapping reservation',
              };
            }
          }

          const bookingRef = await nextRentalSerial(tx, {
            tenantId,
            series: 'RBK',
            prefix: 'RBK-',
            table: 'rental_bookings',
            column: 'booking_ref',
            padWidth: 6,
          });

          const pickupLocation =
            (typeof body.pickupLocation === 'string' && body.pickupLocation.trim()) || null;
          const dropoffLocation =
            (typeof body.dropoffLocation === 'string' && body.dropoffLocation.trim()) ||
            pickupLocation;
          const quoteNotes =
            typeof quotation.notes === 'string' && quotation.notes.trim()
              ? quotation.notes.trim()
              : null;

          const booking = await tx.rentalBooking.create({
            data: {
              tenantId,
              bookingRef,
              customerId: customer!.id,
              vehicleId: resolvedVehicleId,
              vehicleCategory,
              pickupDate,
              dropoffDate: returnDate,
              pickupLocation,
              dropoffLocation,
              totalDays: rentalDays,
              dailyRate,
              totalAmount: grandTotal,
              currency: 'AED',
              status: confirmImmediately ? 'CONFIRMED' : 'PENDING',
              channel: 'QUOTATION',
              notes: quoteNotes
                ? `[From Quote ${quotation.quote_no ?? quoteId}] ${quoteNotes}`
                : `[From Quote ${quotation.quote_no ?? quoteId}]`,
            },
          });

          if (confirmImmediately && resolvedVehicleId && typeof tx.vehicle?.updateMany === 'function') {
            await withSavepoint(
              tx,
              'qt_convert_reserve_veh',
              () =>
                tx.vehicle.updateMany({
                  where: { id: resolvedVehicleId, tenantId, status: 'AVAILABLE' },
                  data: { status: 'RESERVED' },
                }),
              { count: 0 },
            );
          }

          let agreement = null;
          if (body.createDraftAgreement === true || confirmImmediately) {
            const agreementNo = await nextRentalSerial(tx, {
              tenantId,
              series: 'RA',
              prefix: 'RA-',
              table: 'rental_agreements',
              column: 'agreement_no',
              padWidth: 6,
            });
            agreement = await tx.rentalAgreement.create({
              data: {
                tenantId,
                agreementNo,
                bookingId: booking.id,
                customerId: customer!.id,
                vehicleId: resolvedVehicleId,
                startDate: pickupDate,
                endDate: returnDate,
                dailyRate,
                totalAmount: grandTotal,
                securityDeposit: depositAmount > 0 ? depositAmount : null,
                currency: 'AED',
                status: 'DRAFT',
              },
            });
          }

          const convertedRef = booking.bookingRef ?? booking.id;
          const [updatedQuotation] = await withSavepoint<Row[]>(
            tx,
            'qt_convert_update_status',
            () =>
              tx.$queryRawUnsafe<Row[]>(
                `UPDATE rental_quotations
                    SET status = 'CONVERTED',
                        accepted_at = COALESCE(accepted_at, NOW()),
                        converted_to = $1,
                        updated_at = NOW()
                  WHERE id::text = $2
                    AND tenant_id::text = $3
                    AND deleted_at IS NULL
                  RETURNING *`,
                convertedRef,
                quoteId,
                tenantId,
              ),
            [],
          );

          // Fallback if converted_to column was not yet migrated on an older test schema
          if (!updatedQuotation) {
            await withSavepoint(
              tx,
              'qt_convert_fallback_status',
              () =>
                tx.$executeRawUnsafe(
                  `UPDATE rental_quotations
                      SET status = 'CONVERTED',
                          accepted_at = COALESCE(accepted_at, NOW()),
                          updated_at = NOW()
                    WHERE id::text = $1
                      AND tenant_id::text = $2
                      AND deleted_at IS NULL`,
                  quoteId,
                  tenantId,
                ),
              0,
            );
          }

          if (quotation.inquiry_id) {
            await withSavepoint(
              tx,
              'qt_convert_sync_inquiry',
              () =>
                tx.$executeRawUnsafe(
                  `UPDATE rental_inquiries
                      SET status = 'CONVERTED',
                          converted_to = $1,
                          updated_at = NOW()
                    WHERE id::text = $2
                      AND tenant_id::text = $3
                      AND deleted_at IS NULL`,
                  convertedRef,
                  String(quotation.inquiry_id),
                  tenantId,
                ),
              0,
            );
          }

          return {
            kind: 'ok' as const,
            booking,
            agreement,
            customer,
            quotation: updatedQuotation ?? {
              ...quotation,
              status: 'CONVERTED',
              converted_to: convertedRef,
            },
          };
        },
      );
    });

    if (outcome.kind === 'err') {
      return NextResponse.json({ error: outcome.error }, { status: outcome.status });
    }

    return NextResponse.json(
      {
        booking: outcome.booking,
        agreement: outcome.agreement,
        customer: outcome.customer,
        quotation: outcome.quotation,
      },
      { status: 201 },
    );
  } catch (err) {
    if (isRentalSecurityError(err)) {
      return NextResponse.json({ error: err.message, code: err.code }, { status: err.status });
    }
    console.error('[POST /api/rental/quotations/[id]/convert] error:', err);
    return NextResponse.json({ error: 'Failed to convert quotation' }, { status: 500 });
  }
}
