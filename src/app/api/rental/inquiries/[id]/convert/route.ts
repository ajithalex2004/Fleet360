export const dynamic = 'force-dynamic';

/**
 * POST /api/rental/inquiries/[id]/convert
 * Atomically converts a RentalInquiry into either:
 *   - a formal RentalQuotation (`target = 'QUOTATION'`, default), or
 *   - a direct RentalBooking (`target = 'BOOKING'`, auto-matching or creating RentalCustomer).
 * Marks the source inquiry `status = 'CONVERTED'` and stores the downstream reference in `converted_to`.
 */

import { NextRequest, NextResponse } from 'next/server';
import { requireAuthorizedTenant, stripTenantOwnershipFields } from '@/lib/tenant-context';
import { withTenantRls, type TxClient } from '@/lib/rls';
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
import { quoteRentalRateInTx } from '@/lib/rental-rate-engine';

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

async function nextQuoteNo(tx: TxClient, tenantId: string): Promise<string> {
  const ym = new Date().toISOString().slice(0, 7).replace('-', '');
  if (typeof (tx as { $executeRawUnsafe?: unknown }).$executeRawUnsafe === 'function') {
    return nextRentalSerial(tx, {
      tenantId,
      series: `RQT-${ym}`,
      prefix: `RQT-${ym}-`,
      table: 'rental_quotations',
      column: 'quote_no',
      padWidth: 4,
    });
  }
  return `RQT-${ym}-0001`;
}

export async function POST(req: NextRequest, props: { params: Promise<{ id: string }> }) {
  const params = await props.params;
  const inquiryId = params.id?.trim();

  const authz = requireAuthorizedTenant(req);
  if (!authz.ok) {
    return NextResponse.json({ error: authz.error }, { status: authz.status });
  }
  const { tenantId } = authz;

  if (!inquiryId) {
    return NextResponse.json({ error: 'Inquiry ID is required' }, { status: 400 });
  }

  try {
    const bodyRaw = await req.json().catch(() => ({}));
    const body = stripTenantOwnershipFields(
      (bodyRaw && typeof bodyRaw === 'object' ? bodyRaw : {}) as Record<string, unknown>,
    ) as Record<string, unknown>;

    const target = String(body.target ?? 'QUOTATION').trim().toUpperCase();
    if (target !== 'QUOTATION' && target !== 'BOOKING') {
      return NextResponse.json(
        { error: "Invalid conversion target; expected 'QUOTATION' or 'BOOKING'" },
        { status: 400 },
      );
    }

    const permDenied = await requireRentalPermission(
      req.headers,
      tenantId,
      'create',
      target === 'BOOKING' ? 'bookings' : 'quotations',
      req.nextUrl.pathname,
    );
    if (permDenied) return permDenied;

    const hasManualRate =
      body.dailyRate !== undefined && body.dailyRate !== null && body.dailyRate !== '';
    if (hasManualRate || body.rateOverride === true) {
      const rateDenied = await requireRentalPermission(
        req.headers,
        tenantId,
        'approve',
        'rates',
        req.nextUrl.pathname,
      );
      if (rateDenied) return rateDenied;
    }

    const allowCreditOverride = await hasRentalPermission(
      req.headers,
      tenantId,
      'approve',
      'customers',
    );

    const outcome = await withTenantRls(prisma, tenantId, async (tx) => {
      const inqRows = await tx.$queryRawUnsafe<Row[]>(
        `SELECT *
           FROM rental_inquiries
          WHERE id::text = $1
            AND tenant_id::text = $2
            AND deleted_at IS NULL
          LIMIT 1`,
        inquiryId,
        tenantId,
      );
      const inquiry = inqRows[0];
      if (!inquiry) {
        return { kind: 'err' as const, status: 404, error: 'Inquiry not found' };
      }

      const currentStatus = String(inquiry.status ?? 'NEW').toUpperCase();
      if (currentStatus === 'CONVERTED') {
        return {
          kind: 'err' as const,
          status: 409,
          error: `Inquiry ${inquiry.inquiry_no ?? inquiryId} has already been converted (${inquiry.converted_to ?? 'completed'})`,
        };
      }
      if (currentStatus === 'CANCELLED' || currentStatus === 'LOST') {
        return {
          kind: 'err' as const,
          status: 409,
          error: `Cannot convert an inquiry in ${currentStatus} status`,
        };
      }

      const defaultStart = new Date();
      defaultStart.setUTCHours(0, 0, 0, 0);
      const pickupDate =
        parseDateOrNull(body.pickupDate) ??
        parseDateOrNull(inquiry.pickup_date) ??
        defaultStart;

      const defaultDays = Math.max(1, Number(inquiry.rental_days ?? 3) || 3);
      const fallbackEnd = new Date(pickupDate.getTime() + defaultDays * 86_400_000);
      const returnDate =
        parseDateOrNull(body.returnDate ?? body.dropoffDate) ??
        parseDateOrNull(inquiry.return_date) ??
        fallbackEnd;

      if (returnDate.getTime() < pickupDate.getTime()) {
        return {
          kind: 'err' as const,
          status: 400,
          error: 'Return date must be on or after pickup date',
        };
      }

      const rentalDays = Math.max(
        1,
        Math.ceil((returnDate.getTime() - pickupDate.getTime()) / 86_400_000),
      );

      const vehicleCategory = (
        (typeof body.vehicleType === 'string' && body.vehicleType.trim()) ||
        (typeof body.vehicleCategory === 'string' && body.vehicleCategory.trim()) ||
        (typeof inquiry.vehicle_type === 'string' && inquiry.vehicle_type.trim()) ||
        'ECONOMY'
      ).toUpperCase();

      const customerName =
        (typeof body.customerName === 'string' && body.customerName.trim()) ||
        String(inquiry.customer_name ?? 'Walk-In Lead').trim();
      const customerEmail =
        (typeof body.email === 'string' && body.email.trim()) ||
        (typeof inquiry.email === 'string' && inquiry.email.trim() ? inquiry.email.trim() : null);
      const customerPhone =
        (typeof body.phone === 'string' && body.phone.trim()) ||
        (typeof inquiry.phone === 'string' && inquiry.phone.trim() ? inquiry.phone.trim() : '');
      const pickupLocation =
        (typeof body.pickupLocation === 'string' && body.pickupLocation.trim()) ||
        (typeof inquiry.pickup_location === 'string' && inquiry.pickup_location.trim()
          ? inquiry.pickup_location.trim()
          : null);
      const notes =
        (typeof body.notes === 'string' && body.notes.trim()) ||
        (typeof inquiry.notes === 'string' && inquiry.notes.trim() ? inquiry.notes.trim() : null);

      let dailyRate = hasManualRate ? Math.max(0, Number(body.dailyRate) || 0) : 0;
      let subtotal = round2(dailyRate * rentalDays);
      let vatAmount = round2(subtotal * 0.05);
      let grandTotal = round2(subtotal + vatAmount);

      if (!hasManualRate) {
        const masterQuote = await quoteRentalRateInTx(tx, tenantId, {
          vehicleCategory,
          pickupDate,
          dropoffDate: returnDate,
          pickupLocationCode: pickupLocation ?? undefined,
          channel: 'DIRECT',
          currency: 'AED',
        });
        if (masterQuote.dailyRate > 0) {
          dailyRate = masterQuote.dailyRate;
          subtotal = masterQuote.subtotal;
          vatAmount = masterQuote.taxAmount;
          grandTotal = masterQuote.totalAmount;
        } else {
          // Safe fallback standard daily tariff if tenant has not seeded a category rule yet
          dailyRate = 150;
          subtotal = round2(dailyRate * rentalDays);
          vatAmount = round2(subtotal * 0.05);
          grandTotal = round2(subtotal + vatAmount);
        }
      }

      const depositAmount =
        body.depositAmount !== undefined && body.depositAmount !== null && body.depositAmount !== ''
          ? Math.max(0, round2(Number(body.depositAmount) || 0))
          : 1500;

      // ── Path 1: Convert Inquiry -> Formal Quotation ──
      if (target === 'QUOTATION') {
        const quoteNo = await nextQuoteNo(tx, tenantId);
        const validUntil = new Date();
        validUntil.setDate(validUntil.getDate() + 7);

        const [quotation] = await tx.$queryRawUnsafe<Row[]>(
          `INSERT INTO rental_quotations
             (quote_no, inquiry_id, customer_name, email, phone, vehicle_type, vehicle_name,
              pickup_date, return_date, rental_days, daily_rate, subtotal, vat_amount,
              grand_total, deposit_amount, status, valid_until, notes, tenant_id)
           VALUES
             ($1, $2, $3, $4, $5, $6, $7,
              $8::date, $9::date, $10, $11, $12, $13,
              $14, $15, 'DRAFT', $16::date, $17, $18)
           RETURNING *`,
          quoteNo,
          String(inquiry.id),
          customerName,
          customerEmail,
          customerPhone || null,
          vehicleCategory,
          typeof body.vehicleName === 'string' && body.vehicleName.trim()
            ? body.vehicleName.trim()
            : null,
          pickupDate.toISOString().slice(0, 10),
          returnDate.toISOString().slice(0, 10),
          rentalDays,
          dailyRate,
          subtotal,
          vatAmount,
          grandTotal,
          depositAmount,
          validUntil.toISOString().slice(0, 10),
          notes,
          tenantId,
        );

        const [updatedInquiry] = await tx.$queryRawUnsafe<Row[]>(
          `UPDATE rental_inquiries
              SET status = 'CONVERTED',
                  converted_to = $1,
                  updated_at = NOW()
            WHERE id::text = $2
              AND tenant_id::text = $3
              AND deleted_at IS NULL
            RETURNING *`,
          quoteNo,
          inquiryId,
          tenantId,
        );

        return {
          kind: 'ok_quote' as const,
          quotation,
          inquiry: updatedInquiry ?? inquiry,
        };
      }

      // ── Path 2: Convert Inquiry -> Direct Booking ──
      const explicitCustomerId =
        typeof body.customerId === 'string' && body.customerId.trim()
          ? body.customerId.trim()
          : null;
      const requestedVehicleId =
        typeof body.vehicleId === 'string' && body.vehicleId.trim()
          ? body.vehicleId.trim()
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
            phone: customerPhone || '0000000000',
            customerType: 'INDIVIDUAL',
          },
        });
      }

      await assertRentalForeignKeysInTenant(tx, tenantId, {
        customerId: customer.id,
        vehicleId: requestedVehicleId,
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
        { entityKey: inquiryId, vehicleIds: [requestedVehicleId] },
        async () => {
          if (requestedVehicleId) {
            const conflict = await checkVehicleRentalConflict(tx, {
              tenantId,
              vehicleId: requestedVehicleId,
              startDate: pickupDate,
              endDate: returnDate,
              checkGrounding: true,
            });
            if (conflict.hasConflict) {
              return {
                kind: 'err' as const,
                status: 409,
                error: conflict.reason ?? 'Selected vehicle is unavailable for these dates',
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

          const booking = await tx.rentalBooking.create({
            data: {
              tenantId,
              bookingRef,
              customerId: customer!.id,
              vehicleId: requestedVehicleId,
              vehicleCategory,
              pickupDate,
              dropoffDate: returnDate,
              pickupLocation,
              dropoffLocation: pickupLocation,
              totalDays: rentalDays,
              dailyRate,
              totalAmount: grandTotal,
              currency: 'AED',
              status: 'PENDING',
              channel: String(inquiry.source ?? 'INQUIRY'),
              notes: notes
                ? `[From Inquiry ${inquiry.inquiry_no ?? inquiryId}] ${notes}`
                : `[From Inquiry ${inquiry.inquiry_no ?? inquiryId}]`,
            },
          });

          const [updatedInquiry] = await withSavepoint<Row[]>(
            tx,
            'inq_convert_mark_bk',
            () =>
              tx.$queryRawUnsafe<Row[]>(
                `UPDATE rental_inquiries
                    SET status = 'CONVERTED',
                        converted_to = $1,
                        updated_at = NOW()
                  WHERE id::text = $2
                    AND tenant_id::text = $3
                    AND deleted_at IS NULL
                  RETURNING *`,
                booking.bookingRef ?? booking.id,
                inquiryId,
                tenantId,
              ),
            [],
          );

          return {
            kind: 'ok_booking' as const,
            booking,
            customer,
            inquiry: updatedInquiry ?? inquiry,
          };
        },
      );
    });

    if (outcome.kind === 'err') {
      return NextResponse.json({ error: outcome.error }, { status: outcome.status });
    }
    if (outcome.kind === 'ok_quote') {
      return NextResponse.json(
        {
          target: 'QUOTATION',
          quotation: outcome.quotation,
          inquiry: outcome.inquiry,
        },
        { status: 201 },
      );
    }

    return NextResponse.json(
      {
        target: 'BOOKING',
        booking: outcome.booking,
        customer: outcome.customer,
        inquiry: outcome.inquiry,
      },
      { status: 201 },
    );
  } catch (err) {
    if (isRentalSecurityError(err)) {
      return NextResponse.json({ error: err.message, code: err.code }, { status: err.status });
    }
    console.error('[POST /api/rental/inquiries/[id]/convert] error:', err);
    return NextResponse.json({ error: 'Failed to convert inquiry' }, { status: 500 });
  }
}
