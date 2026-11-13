export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { prisma } from '@/lib/prisma';
import { withTenantRls } from '@/lib/rls';
import { stripTenantOwnershipFields } from '@/lib/tenant-context';
import type { CardPreAuthResult } from '@/lib/rac-portal/preauth-provider';
import {
  authorizeGatewayHold,
  bestEffortReleaseGatewayHold,
  linkPreAuthToBookingInTx,
  recordAuthorizedPreAuthInTx,
  toPublicRacPreAuth,
} from '@/lib/rac-portal/preauth-store';
import {
  checkVehicleRentalConflict,
  nextRentalSerial,
  withRentalLock,
} from '@/lib/rental/locks';
import {
  assertCustomerEligibleForRental,
  isRentalSecurityError,
} from '@/lib/rental/security-guards';
import {
  ALL_RAC_PORTAL_ROLES,
  BOOKING_RAC_PORTAL_ROLES,
  canonicalPortalCategory,
  enforceRacPortalPaymentRateLimit,
  portalCategoriesMatch,
  quoteCorporatePortalRateInTx,
  requireRacPortalRole,
} from '../_helpers';

class PortalBookingError extends Error {
  readonly statusCode: number;
  constructor(message: string, statusCode: number) {
    super(message);
    this.name = 'PortalBookingError';
    this.statusCode = statusCode;
  }
}

const CreateBookingSchema = z.object({
  category: z.string().trim().min(1, 'Vehicle category is required').max(64),
  vehicleId: z.string().trim().min(1).max(128).optional(),
  pickupDate: z.string().min(1, 'Pick-up date is required'),
  dropoffDate: z.string().min(1, 'Drop-off date is required'),
  pickupLocation: z.string().trim().min(1, 'Pick-up branch/location is required').max(200),
  dropoffLocation: z.string().trim().min(1, 'Drop-off branch/location is required').max(200),
  preauthId: z.string().uuid('A valid card pre-authorization hold is required').optional(),
  preauthAmount: z.number().positive().max(250_000).optional(),
  cardToken: z.string().trim().min(3).max(160).optional(),
  cardBrand: z.string().trim().min(2).max(32).optional(),
  cardLast4: z.string().regex(/^\d{4}$/).optional(),
  cardholderName: z.string().trim().min(2).max(120).optional(),
  expiryMonth: z.number().int().min(1).max(12).optional(),
  expiryYear: z.number().int().min(2024).max(2099).optional(),
  driverName: z.string().trim().max(120).optional(),
  driverPhone: z.string().trim().max(40).optional(),
  flightNumber: z.string().trim().max(30).optional(),
  specialRequests: z.string().trim().max(500).optional(),
  insuranceTier: z.enum(['BASIC', 'STANDARD', 'FULL_ZERO_EXCESS']).optional(),
  ancillaries: z.array(z.string().trim().max(64)).max(20).optional(),
});

interface BookingListRow {
  id: string;
  booking_ref: string | null;
  customer_id: string;
  vehicle_id: string | null;
  vehicle_category: string | null;
  pickup_date: string | Date;
  dropoff_date: string | Date;
  pickup_location: string | null;
  dropoff_location: string | null;
  total_days: number | null;
  daily_rate: string | number | null;
  total_amount: string | number | null;
  currency: string | null;
  status: string | null;
  channel: string | null;
  notes: string | null;
  created_at: string | Date;
  v_make: string | null;
  v_model: string | null;
  v_plate_number: string | null;
  v_license_plate: string | null;
  v_registration_no: string | null;
  pa_id: string | null;
  pa_auth_code: string | null;
  pa_amount: string | number | null;
  pa_card_brand: string | null;
  pa_card_last4: string | null;
  pa_status: string | null;
  pa_expires_at: string | Date | null;
  ra_id: string | null;
  ra_no: string | null;
}

export async function GET(req: NextRequest) {
  const ctx = await requireRacPortalRole(req, ALL_RAC_PORTAL_ROLES);
  if (ctx instanceof NextResponse) return ctx;

  try {
    const bookings = await withTenantRls(prisma, ctx.tenantId, async (tx) => {
      const rows = await tx.$queryRawUnsafe<BookingListRow[]>(
        `SELECT
           rb.id,
           rb.booking_ref,
           rb.customer_id,
           rb.vehicle_id,
           rb.vehicle_category,
           rb.pickup_date,
           rb.dropoff_date,
           rb.pickup_location,
           rb.dropoff_location,
           rb.total_days,
           rb.daily_rate,
           rb.total_amount,
           rb.currency,
           rb.status,
           rb.channel,
           rb.notes,
           rb.created_at,
           v.make AS v_make,
           v.model AS v_model,
           v.plate_number AS v_plate_number,
           v.license_plate AS v_license_plate,
           v.registration_no AS v_registration_no,
           pa.id::text AS pa_id,
           pa.authorization_code AS pa_auth_code,
           pa.amount AS pa_amount,
           pa.card_brand AS pa_card_brand,
           pa.card_last4 AS pa_card_last4,
           pa.status AS pa_status,
           pa.expires_at AS pa_expires_at,
           ra.id AS ra_id,
           ra.agreement_no AS ra_no
         FROM rental_bookings rb
         LEFT JOIN vehicles v
           ON v.id = rb.vehicle_id AND v.tenant_id::text = rb.tenant_id::text
         LEFT JOIN LATERAL (
           SELECT p.id, p.authorization_code, p.amount, p.card_brand, p.card_last4, p.status, p.expires_at
             FROM rac_card_preauths p
            WHERE p.tenant_id = rb.tenant_id::text
              AND p.customer_id = rb.customer_id
              AND p.booking_id = rb.id
            ORDER BY p.created_at DESC
            LIMIT 1
         ) pa ON TRUE
         LEFT JOIN rental_agreements ra
           ON ra.booking_id = rb.id
          AND ra.tenant_id::text = rb.tenant_id::text
          AND ra.deleted_at IS NULL
         WHERE rb.tenant_id::text = $1
           AND rb.customer_id = $2
           AND rb.deleted_at IS NULL
         ORDER BY rb.created_at DESC`,
        ctx.tenantId,
        ctx.customerId,
      );

      return rows.map((r) => {
        const plateNumber =
          r.v_plate_number ?? r.v_license_plate ?? r.v_registration_no ?? null;
        return {
          id: r.id,
          bookingRef: r.booking_ref ?? `RBK-${r.id.slice(0, 8).toUpperCase()}`,
          vehicleId: r.vehicle_id,
          vehicleCategory: r.vehicle_category ?? 'MID_SIZE',
          pickupDate: new Date(r.pickup_date).toISOString(),
          dropoffDate: new Date(r.dropoff_date).toISOString(),
          pickupLocation: r.pickup_location,
          dropoffLocation: r.dropoff_location,
          totalDays: r.total_days ?? 1,
          dailyRate: Number(r.daily_rate ?? 0),
          totalAmount: Number(r.total_amount ?? 0),
          currency: r.currency ?? 'AED',
          status: r.status ?? 'CONFIRMED',
          channel: r.channel ?? 'CORPORATE',
          notes: r.notes,
          createdAt: new Date(r.created_at).toISOString(),
          vehicle: r.vehicle_id
            ? {
                id: r.vehicle_id,
                make: r.v_make ?? 'Fleet',
                model: r.v_model ?? 'Vehicle',
                plateNumber: plateNumber ?? 'TBA',
              }
            : null,
          preauth: r.pa_id
            ? {
                id: r.pa_id,
                authorizationCode: r.pa_auth_code,
                amount: Number(r.pa_amount ?? 0),
                authorizedAmount: Number(r.pa_amount ?? 0),
                cardBrand: r.pa_card_brand ?? 'CARD',
                cardLast4: r.pa_card_last4 ?? '0000',
                status: r.pa_status ?? 'AUTHORIZED',
                expiresAt: r.pa_expires_at ? new Date(r.pa_expires_at).toISOString() : null,
              }
            : null,
          agreementId: r.ra_id ?? null,
          agreementNo: r.ra_no ?? null,
        };
      });
    });

    return NextResponse.json({ bookings });
  } catch (err) {
    console.error('[rac-portal/bookings] GET failed:', err);
    return NextResponse.json(
      { error: 'Failed to load corporate reservations' },
      { status: 500 },
    );
  }
}

export async function POST(req: NextRequest) {
  const ctx = await requireRacPortalRole(
    req,
    BOOKING_RAC_PORTAL_ROLES,
    'Corporate Booker (RAC_B2B_BOOKER) or B2B Admin (RAC_B2B_ADMIN) role is required to create reservations.',
  );
  if (ctx instanceof NextResponse) return ctx;

  let inlineGatewayHold: CardPreAuthResult | null = null;
  let inlineHoldAmount = 0;

  try {
    const rawBody = await req.json().catch(() => null);
    if (
      rawBody &&
      typeof rawBody === 'object' &&
      ('cardNumber' in rawBody || 'pan' in rawBody || 'cvv' in rawBody || 'cvc' in rawBody)
    ) {
      return NextResponse.json(
        { error: 'PCI-DSS violation blocked: raw card numbers and CVV must never be transmitted.' },
        { status: 400 },
      );
    }

    const sanitizedBody =
      rawBody && typeof rawBody === 'object'
        ? stripTenantOwnershipFields(rawBody as Record<string, unknown>)
        : rawBody;
    const parsed = CreateBookingSchema.safeParse(sanitizedBody);
    if (!parsed.success) {
      return NextResponse.json(
        { error: parsed.error.issues[0]?.message ?? 'Invalid booking payload' },
        { status: 400 },
      );
    }

    const body = parsed.data;
    const requestedCategory = body.category.trim();
    const hasInlineCard = Boolean(body.cardholderName || body.cardToken);

    if (!body.preauthId && !hasInlineCard) {
      return NextResponse.json(
        { error: 'A valid card pre-authorization hold is required' },
        { status: 400 },
      );
    }

    const pickupDt = new Date(body.pickupDate);
    const dropoffDt = new Date(body.dropoffDate);
    if (isNaN(pickupDt.getTime()) || isNaN(dropoffDt.getTime()) || dropoffDt <= pickupDt) {
      return NextResponse.json(
        { error: 'Drop-off date and time must be after pick-up date and time' },
        { status: 400 },
      );
    }

    // If caller supplied inline tokenized card details instead of an existing preauthId,
    // authorize the gateway hold BEFORE opening the booking DB transaction (2-phase lock-safe).
    if (!body.preauthId && hasInlineCard) {
      const paymentRl = await enforceRacPortalPaymentRateLimit(ctx.customerId);
      if (paymentRl) return paymentRl;

      const preCheckQuote = await withTenantRls(prisma, ctx.tenantId, async (tx) => {
        const quote = await quoteCorporatePortalRateInTx(tx, ctx.tenantId, {
          category: requestedCategory,
          pickupDate: pickupDt,
          dropoffDate: dropoffDt,
          pickupLocationCode: body.pickupLocation,
          customerId: ctx.customerId,
          insuranceTier: body.insuranceTier ?? 'BASIC',
          ancillaryCodes: body.ancillaries ?? [],
        });

        const requiredDeposit = Math.max(500, quote.depositRequired || 1000);
        const holdAmt = body.preauthAmount ?? quote.preAuthSizing.requiredPreAuthAmount;
        if (holdAmt < requiredDeposit) {
          throw new PortalBookingError(
            `Pre-authorization hold of AED ${holdAmt.toFixed(2)} is below the required deposit of AED ${requiredDeposit.toFixed(2)} for ${requestedCategory}`,
            402,
          );
        }

        await assertCustomerEligibleForRental(tx, {
          tenantId: ctx.tenantId,
          customerId: ctx.customerId,
          dropoffDate: dropoffDt,
          additionalExposureAed: holdAmt >= quote.totalAmount ? 0 : quote.totalAmount,
        });

        return { quote, holdAmt };
      });

      inlineHoldAmount = preCheckQuote.holdAmt;
      try {
        inlineGatewayHold = await authorizeGatewayHold({
          tenantId: ctx.tenantId,
          customerId: ctx.customerId,
          amount: inlineHoldAmount,
          currency: preCheckQuote.quote.currency ?? 'AED',
          cardToken: body.cardToken ?? null,
          cardBrand: body.cardBrand ?? 'VISA',
          cardLast4: body.cardLast4 ?? '4242',
          cardholderName: body.cardholderName ?? ctx.user.fullName ?? ctx.user.email,
          expiryMonth: body.expiryMonth ?? null,
          expiryYear: body.expiryYear ?? null,
          notes: `Online B2B Portal Reservation Hold (${requestedCategory})`,
        });
      } catch (gatewayErr) {
        const msg =
          gatewayErr instanceof Error
            ? gatewayErr.message
            : 'Card pre-authorization was declined by the issuer';
        return NextResponse.json({ error: msg }, { status: 402 });
      }
    }

    const created = await withTenantRls(prisma, ctx.tenantId, async (tx) => {
      // 1. Quote exact corporate rate from the Master Price List
      const quote = await quoteCorporatePortalRateInTx(tx, ctx.tenantId, {
        category: requestedCategory,
        pickupDate: pickupDt,
        dropoffDate: dropoffDt,
        pickupLocationCode: body.pickupLocation,
        customerId: ctx.customerId,
        insuranceTier: body.insuranceTier ?? 'BASIC',
        ancillaryCodes: body.ancillaries ?? [],
      });

      let resolvedPreauthId = body.preauthId ?? '';
      let holdAmount = inlineHoldAmount;
      let holdAuthCode = inlineGatewayHold?.authorizationCode ?? '';

      if (inlineGatewayHold) {
        const recorded = await recordAuthorizedPreAuthInTx(
          tx,
          {
            tenantId: ctx.tenantId,
            customerId: ctx.customerId,
            amount: inlineHoldAmount,
            currency: quote.currency ?? 'AED',
            cardholderName: body.cardholderName ?? ctx.user.fullName ?? ctx.user.email,
            initiatedBy: 'PORTAL_USER',
            initiatedByUser: ctx.user.email,
            notes: `Online B2B Portal Reservation Hold (${requestedCategory})`,
          },
          inlineGatewayHold,
        );
        resolvedPreauthId = recorded.id;
        holdAmount = recorded.amount;
        holdAuthCode = recorded.authorizationCode;
      } else {
        // Verify existing pre-authorization hold belongs to (tenantId, customerId) and is AUTHORIZED & unlinked
        const paRows = await tx.$queryRawUnsafe<
          Array<{
            id: string;
            amount: string | number;
            currency: string;
            status: string;
            booking_id: string | null;
            expires_at: string | Date | null;
            authorization_code: string;
          }>
        >(
          `SELECT id::text AS id, amount, currency, status, booking_id, expires_at, authorization_code
             FROM rac_card_preauths
            WHERE id = $1::uuid AND tenant_id = $2 AND customer_id = $3
            LIMIT 1`,
          resolvedPreauthId,
          ctx.tenantId,
          ctx.customerId,
        );
        const preauthRow = paRows[0];
        if (!preauthRow) {
          throw new PortalBookingError('Card pre-authorization hold not found', 404);
        }
        if (preauthRow.status !== 'AUTHORIZED') {
          throw new PortalBookingError(
            `Card pre-authorization hold is in status ${preauthRow.status} and cannot be used`,
            409,
          );
        }
        if (preauthRow.booking_id) {
          throw new PortalBookingError(
            'Card pre-authorization hold is already linked to another reservation',
            409,
          );
        }
        if (preauthRow.expires_at && new Date(preauthRow.expires_at) <= new Date()) {
          throw new PortalBookingError('Card pre-authorization hold has expired', 409);
        }
        holdAmount = Number(preauthRow.amount);
        holdAuthCode = preauthRow.authorization_code;
      }

      const requiredDeposit = Math.max(500, quote.depositRequired || 1000);
      if (holdAmount < requiredDeposit) {
        throw new PortalBookingError(
          `Pre-authorization hold of AED ${holdAmount.toFixed(2)} is below the required deposit of AED ${requiredDeposit.toFixed(2)} for ${requestedCategory}`,
          402,
        );
      }

      // 3. Enforce unified rental customer eligibility (blacklist, license expiry, & corporate credit limit)
      await assertCustomerEligibleForRental(tx, {
        tenantId: ctx.tenantId,
        customerId: ctx.customerId,
        dropoffDate: dropoffDt,
        additionalExposureAed: holdAmount >= quote.totalAmount ? 0 : quote.totalAmount,
      });

      // 4. Resolve candidate vehicle ID(s) before acquiring deterministic vehicle lock.
      //    Include vehicles currently RENTED or RESERVED today if their window has zero overlap,
      //    strictly restricted to RAC (`vehicle_usage = 'RENTAL'`).
      let candidateVehicleId = body.vehicleId ?? null;
      if (!candidateVehicleId) {
        const candidates = await tx.$queryRawUnsafe<
          Array<{
            id: string;
            category: string | null;
            vehicle_group: string | null;
            vehicle_class: string | null;
            type: string | null;
          }>
        >(
          `SELECT v.id, v.category, v.vehicle_group, v.vehicle_class, v.type
             FROM vehicles v
            WHERE v.tenant_id::text = $1
              AND v.deleted_at IS NULL
              AND COALESCE(v.is_active, true) = true
              AND UPPER(COALESCE(v.vehicle_usage, 'RENTAL')) = 'RENTAL'
              AND v.status IN ('AVAILABLE', 'RESERVED', 'RENTED')
              AND NOT EXISTS (
                SELECT 1 FROM rental_bookings rb
                 WHERE rb.tenant_id::text = $1
                   AND rb.vehicle_id = v.id
                   AND rb.deleted_at IS NULL
                   AND rb.status IN ('CONFIRMED', 'ACTIVE')
                   AND rb.pickup_date < $3::timestamptz
                   AND rb.dropoff_date > $2::timestamptz
              )
              AND NOT EXISTS (
                SELECT 1 FROM rental_agreements ra
                 WHERE ra.tenant_id::text = $1
                   AND ra.vehicle_id = v.id
                   AND ra.deleted_at IS NULL
                   AND ra.status = 'ACTIVE'
                   AND ra.start_date < $3::timestamptz
                   AND ra.end_date > $2::timestamptz
              )
            ORDER BY CASE WHEN v.status = 'AVAILABLE' THEN 0 ELSE 1 END ASC, v.created_at ASC`,
          ctx.tenantId,
          pickupDt.toISOString(),
          dropoffDt.toISOString(),
        );

        const categoryCandidates = candidates.filter((v) => {
          const rawCat = v.category ?? v.vehicle_group ?? v.vehicle_class ?? v.type ?? 'MID_SIZE';
          const portalCat = canonicalPortalCategory(rawCat);
          return (
            portalCategoriesMatch(rawCat, requestedCategory) ||
            portalCategoriesMatch(portalCat, requestedCategory)
          );
        });

        for (const cand of categoryCandidates) {
          const preConflict = await checkVehicleRentalConflict(tx, {
            tenantId: ctx.tenantId,
            vehicleId: cand.id,
            startDate: pickupDt,
            endDate: dropoffDt,
            checkGrounding: true,
          });
          if (!preConflict.hasConflict) {
            candidateVehicleId = cand.id;
            break;
          }
        }

        if (!candidateVehicleId) {
          throw new PortalBookingError(
            `No available vehicles remain in category ${requestedCategory} for the selected dates`,
            409,
          );
        }
      }

      // 5. Lock physical vehicle + booking serial & atomically create reservation + link pre-auth
      return withRentalLock(
        tx,
        ctx.tenantId,
        { vehicleIds: [candidateVehicleId] },
        async () => {
          const vehRows = await tx.$queryRawUnsafe<
            Array<{
              id: string;
              make: string | null;
              model: string | null;
              status: string | null;
              vehicle_usage: string | null;
              plate_number: string | null;
              license_plate: string | null;
              registration_no: string | null;
            }>
          >(
            `SELECT id, make, model, status, vehicle_usage, plate_number, license_plate, registration_no
               FROM vehicles
              WHERE id = $1
                AND tenant_id::text = $2
                AND deleted_at IS NULL
                AND UPPER(COALESCE(vehicle_usage, 'RENTAL')) = 'RENTAL'
              LIMIT 1`,
            candidateVehicleId,
            ctx.tenantId,
          );
          const veh = vehRows[0];
          const vehStatusUpper = String(veh?.status ?? '').toUpperCase();
          if (!veh || !['AVAILABLE', 'RESERVED', 'RENTED'].includes(vehStatusUpper)) {
            throw new PortalBookingError(
              'Selected vehicle is no longer available in the Rent-A-Car fleet. Please pick another vehicle or search again.',
              409,
            );
          }

          const conflict = await checkVehicleRentalConflict(tx, {
            tenantId: ctx.tenantId,
            vehicleId: veh.id,
            startDate: pickupDt,
            endDate: dropoffDt,
            checkGrounding: true,
          });
          if (conflict.hasConflict) {
            throw new PortalBookingError(
              conflict.reason ?? 'Vehicle has a conflicting reservation during this period',
              409,
            );
          }

          const bookingRef = await nextRentalSerial(tx, {
            tenantId: ctx.tenantId,
            series: 'rental-booking',
            prefix: 'RBK-',
            table: 'rental_bookings',
            column: 'booking_ref',
            padWidth: 6,
          });

          const noteLines = [
            `[B2B Portal Reservation by ${ctx.user.fullName ?? ctx.user.email} <${ctx.user.email}>]`,
            `Pre-Auth Hold: ${holdAuthCode} (AED ${holdAmount.toFixed(2)})`,
            body.insuranceTier ? `Insurance Tier: ${body.insuranceTier}` : null,
            body.driverName ? `Driver: ${body.driverName}` : null,
            body.driverPhone ? `Driver Phone: ${body.driverPhone}` : null,
            body.flightNumber ? `Flight #: ${body.flightNumber}` : null,
            body.ancillaries && body.ancillaries.length > 0
              ? `Ancillaries: ${body.ancillaries.join(', ')}`
              : null,
            body.specialRequests ? `Requests: ${body.specialRequests}` : null,
          ]
            .filter(Boolean)
            .join(' | ');

          const booking = await tx.rentalBooking.create({
            data: {
              tenantId: ctx.tenantId,
              bookingRef,
              customerId: ctx.customerId,
              vehicleId: veh.id,
              vehicleCategory: requestedCategory,
              pickupDate: pickupDt,
              dropoffDate: dropoffDt,
              pickupLocation: body.pickupLocation,
              dropoffLocation: body.dropoffLocation,
              totalDays: quote.totalDays,
              dailyRate: quote.dailyRate,
              totalAmount: quote.totalAmount,
              currency: quote.currency,
              status: 'CONFIRMED',
              channel: 'CORPORATE',
              notes: noteLines,
            },
          });

          await tx.rentalRateQuote.create({
            data: {
              tenantId: ctx.tenantId,
              bookingId: booking.id,
              vehicleCategory: requestedCategory,
              pickupDate: pickupDt,
              dropoffDate: dropoffDt,
              totalDays: quote.totalDays,
              totalHours: quote.totalHours,
              appliedRuleId: quote.appliedRuleId,
              currency: quote.currency,
              baseRentalCharge: quote.baseRentalCharge,
              insurancePlanCode: quote.insurancePlanCode,
              insuranceCharge: quote.insuranceCharge,
              discountPct: quote.discountPct,
              discountAmount: quote.discountAmount,
              taxPct: quote.taxRate,
              taxAmount: quote.taxAmount,
              totalAmount: quote.totalAmount,
              breakdown: JSON.stringify(quote.breakdown),
            },
          });

          const linkedPreauth = await linkPreAuthToBookingInTx(tx, {
            tenantId: ctx.tenantId,
            preauthId: resolvedPreauthId,
            customerId: ctx.customerId,
            bookingId: booking.id,
          });

          if (!linkedPreauth) {
            throw new PortalBookingError(
              'Failed to link card pre-authorization hold to booking (hold may have already been claimed)',
              409,
            );
          }

          const plateNumber =
            veh.plate_number ?? veh.license_plate ?? veh.registration_no ?? 'TBA';

          return {
            booking: {
              id: booking.id,
              bookingRef: booking.bookingRef,
              customerId: booking.customerId,
              vehicleId: booking.vehicleId,
              vehicleCategory: booking.vehicleCategory,
              pickupDate: booking.pickupDate.toISOString(),
              dropoffDate: booking.dropoffDate.toISOString(),
              pickupLocation: booking.pickupLocation,
              dropoffLocation: booking.dropoffLocation,
              totalDays: booking.totalDays,
              dailyRate: Number(booking.dailyRate ?? 0),
              subtotal: quote.subtotal,
              vatAmount: quote.taxAmount,
              totalAmount: Number(booking.totalAmount ?? 0),
              depositStatus: 'HELD',
              depositAmount: linkedPreauth.amount,
              currency: booking.currency ?? 'AED',
              status: booking.status,
              channel: booking.channel,
              notes: booking.notes,
              vehicle: {
                id: veh.id,
                make: veh.make ?? 'Fleet',
                model: veh.model ?? 'Vehicle',
                plateNumber,
              },
            },
            preauth: toPublicRacPreAuth(linkedPreauth),
            quote,
          };
        },
      );
    });

    return NextResponse.json({ ok: true, ...created }, { status: 201 });
  } catch (err) {
    // If an inline gateway hold was placed before the DB tx and the booking tx rolled back,
    // immediately release the hold so no orphaned authorization remains on the customer's card.
    if (inlineGatewayHold?.providerIntentId) {
      await bestEffortReleaseGatewayHold(inlineGatewayHold.providerIntentId);
    }

    if (isRentalSecurityError(err)) {
      return NextResponse.json({ error: err.message, code: err.code }, { status: err.status });
    }
    if (err instanceof PortalBookingError) {
      return NextResponse.json({ error: err.message }, { status: err.statusCode });
    }
    console.error('[rac-portal/bookings] POST failed:', err);
    return NextResponse.json(
      { error: 'Failed to create corporate reservation' },
      { status: 500 },
    );
  }
}
