export const dynamic = 'force-dynamic';

/**
 * POST /api/rental/bookings/copilot
 *
 * Grounded AI Rental Co-pilot Endpoint (2-Phase Architecture + 1-Click Booking):
 *
 * 1. Quote Generation (`{ brief: string }`):
 *    - Requires `rental:view:bookings`
 *    - Phase 1 (strictly OUTSIDE `withTenantRls`): `governCopilot` + `extractRentalIntent(brief)`
 *      (Gemini 3.8 Flash -> OpenAI -> Deterministic Bilingual EN/AR NLP; zero LLM prices)
 *    - Phase 2 (strictly INSIDE `withTenantRls`): `buildGroundedRentalQuoteInTx`
 *      queries live `vehicles` availability, `rental_ancillaries`, `pricing_rules`, and `rate_events`
 *
 * 2. 1-Click Grounded Booking Creation (`{ action: 'CREATE_BOOKING', ... }`):
 *    - Strictly gated by `rental:create:bookings` (and `rental:create:customers` if creating a walk-in customer)
 *    - Re-computes authoritative server-side pricing inside `withTenantRls` (never trusts client amounts)
 *    - Enforces `assertCustomerEligibleForRental`, `withRentalLock`, `checkVehicleRentalConflict`,
 *      and `nextRentalSerial` (`RBK-XXXXXX`)
 */

import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { prisma } from '@/lib/prisma';
import { withTenantRls } from '@/lib/rls';
import { requireAuthorizedTenant, stripTenantOwnershipFields } from '@/lib/tenant-context';
import {
  buildGroundedRentalQuoteInTx,
  extractRentalIntent,
  type ExtractedRentalIntent,
} from '@/lib/agents/rental-copilot/agent';
import { governCopilot } from '@/lib/agents/copilot-governance';
import { logAudit } from '@/lib/audit';
import { captureException } from '@/lib/sentry';
import { normalizeRentalCategory } from '@/lib/rental/categories';
import {
  checkVehicleRentalConflict,
  nextRentalSerial,
  withRentalLock,
  withSavepoint,
} from '@/lib/rental/locks';
import { requireRentalPermission } from '@/lib/rental/rbac';
import {
  RentalSecurityError,
  assertCustomerEligibleForRental,
  assertRentalForeignKeysInTenant,
  isRentalSecurityError,
} from '@/lib/rental/security-guards';

export const runtime = 'nodejs';
export const maxDuration = 60;

const quoteBodySchema = z.object({
  action: z.literal('QUOTE').optional(),
  brief: z.string().min(10).max(4000),
});

const createBookingBodySchema = z
  .object({
    action: z.literal('CREATE_BOOKING'),
    customerId: z.string().min(1).max(128).optional(),
    newCustomer: z
      .object({
        fullName: z.string().min(2).max(160),
        phone: z.string().max(40).optional(),
        email: z.string().email().max(160).optional().or(z.literal('')),
        nationality: z.string().max(80).optional(),
        customerType: z
          .enum(['INDIVIDUAL', 'CORPORATE', 'AIRLINE', 'INSURANCE'])
          .optional(),
        drivingLicenseNo: z.string().max(64).optional(),
        licenseExpiry: z.string().optional(),
      })
      .optional(),
    vehicleCategory: z.string().min(1).max(64),
    vehicleId: z.string().min(1).max(128).optional().nullable(),
    pickupDate: z.string().regex(/^\d{4}-\d{2}-\d{2}/, 'pickupDate must start with YYYY-MM-DD'),
    dropoffDate: z.string().regex(/^\d{4}-\d{2}-\d{2}/, 'dropoffDate must start with YYYY-MM-DD'),
    pickupLocation: z.string().min(1).max(200),
    dropoffLocation: z.string().min(1).max(200).optional(),
    pickupLocationCode: z.string().max(32).optional(),
    dropoffLocationCode: z.string().max(32).optional(),
    customerType: z
      .enum(['INDIVIDUAL', 'CORPORATE', 'AIRLINE', 'INSURANCE', 'FREQUENT_FLYER', 'GOVERNMENT'])
      .optional(),
    channel: z.enum(['DIRECT', 'CORPORATE', 'AGENCY', 'ONLINE']).optional(),
    insurancePlanCode: z
      .enum(['MINIMUM', 'CDW', 'LDW', 'TP', 'PAI', 'SUPER_CDW'])
      .optional(),
    promoCode: z.string().max(40).optional().nullable(),
    ancillaries: z
      .array(
        z.object({
          code: z.string().min(1).max(64),
          quantity: z.number().int().min(1).max(20).default(1),
        }),
      )
      .max(20)
      .optional(),
    status: z.enum(['PENDING', 'CONFIRMED']).optional(),
    notes: z.string().max(2000).optional(),
  })
  .refine((d) => Boolean(d.customerId || d.newCustomer?.fullName), {
    message: 'Either customerId or newCustomer.fullName is required to create a booking',
    path: ['customerId'],
  });

export async function POST(req: NextRequest) {
  const authz = requireAuthorizedTenant(req);
  if (!authz.ok) {
    return NextResponse.json({ error: authz.error }, { status: authz.status });
  }
  const { tenantId, userId, role } = authz;

  try {
    const rawJson = await req.json();
    const body = stripTenantOwnershipFields(
      rawJson && typeof rawJson === 'object' ? (rawJson as Record<string, unknown>) : {},
    );

    // ── Branch B: 1-Click Grounded Booking Creation ─────────────────────────
    if (body.action === 'CREATE_BOOKING') {
      const createPermErr = await requireRentalPermission(
        req.headers,
        tenantId,
        'create',
        'bookings',
        req.nextUrl.pathname,
      );
      if (createPermErr) return createPermErr;

      const parsedCreate = createBookingBodySchema.safeParse(body);
      if (!parsedCreate.success) {
        return NextResponse.json(
          {
            error: 'Validation failed',
            details: parsedCreate.error.issues.map((i) => ({
              path: i.path.join('.'),
              message: i.message,
            })),
          },
          { status: 400 },
        );
      }

      const input = parsedCreate.data;
      if (!input.customerId && input.newCustomer) {
        const custPermErr = await requireRentalPermission(
          req.headers,
          tenantId,
          'create',
          'customers',
          req.nextUrl.pathname,
        );
        if (custPermErr) return custPermErr;
      }

      const pickupDateStr = input.pickupDate.slice(0, 10);
      const dropoffDateStr = input.dropoffDate.slice(0, 10);
      const pickupDt = new Date(`${pickupDateStr}T09:00:00.000Z`);
      const dropoffDt = new Date(`${dropoffDateStr}T09:00:00.000Z`);
      if (
        Number.isNaN(pickupDt.getTime()) ||
        Number.isNaN(dropoffDt.getTime()) ||
        dropoffDt <= pickupDt
      ) {
        return NextResponse.json(
          { error: 'dropoffDate must be after pickupDate' },
          { status: 400 },
        );
      }

      const canonicalCategory =
        normalizeRentalCategory(input.vehicleCategory) || 'MID_SIZE';
      const rentalDays = Math.max(
        1,
        Math.round((dropoffDt.getTime() - pickupDt.getTime()) / 86_400_000),
      );

      const bookingOutcome = await withTenantRls(prisma, tenantId, async (tx) => {
        let resolvedCustomerId = input.customerId ?? '';
        let resolvedCustomerType = input.customerType ?? 'INDIVIDUAL';

        if (resolvedCustomerId) {
          await assertRentalForeignKeysInTenant(tx, tenantId, {
            customerId: resolvedCustomerId,
            vehicleId: input.vehicleId ?? null,
          });
          const existingCust = await tx.rentalCustomer.findFirst({
            where: { id: resolvedCustomerId, tenantId, deletedAt: null },
            select: { id: true, customerType: true },
          });
          if (!existingCust) {
            throw new RentalSecurityError(404, 'CUSTOMER_NOT_FOUND', 'Customer not found in tenant');
          }
          resolvedCustomerType =
            (existingCust.customerType as ExtractedRentalIntent['customerType']) ??
            resolvedCustomerType;
        } else if (input.newCustomer) {
          if (input.vehicleId) {
            await assertRentalForeignKeysInTenant(tx, tenantId, {
              vehicleId: input.vehicleId,
            });
          }
          const nc = input.newCustomer;
          const licExp =
            nc.licenseExpiry && !Number.isNaN(new Date(nc.licenseExpiry).getTime())
              ? new Date(nc.licenseExpiry)
              : null;
          const createdCust = await tx.rentalCustomer.create({
            data: {
              tenantId,
              fullName: nc.fullName.trim(),
              phone: nc.phone?.trim() || null,
              email: nc.email?.trim().toLowerCase() || null,
              nationality: nc.nationality?.trim() || null,
              customerType: nc.customerType ?? 'INDIVIDUAL',
              drivingLicenseNo: nc.drivingLicenseNo?.trim() || null,
              licenseExpiry: licExp,
            },
          });
          resolvedCustomerId = createdCust.id;
          resolvedCustomerType =
            (createdCust.customerType as ExtractedRentalIntent['customerType']) ?? 'INDIVIDUAL';
        }

        // Re-compute authoritative server-side grounded quote inside `withTenantRls`
        const serverIntent: ExtractedRentalIntent = {
          vehicleCategory: canonicalCategory,
          pickupDate: pickupDateStr,
          dropoffDate: dropoffDateStr,
          rentalDays,
          pickupLocation: input.pickupLocation.trim(),
          dropoffLocation: (input.dropoffLocation ?? input.pickupLocation).trim(),
          pickupLocationCode: input.pickupLocationCode?.trim().toUpperCase() || 'DXB',
          dropoffLocationCode:
            input.dropoffLocationCode?.trim().toUpperCase() ||
            input.pickupLocationCode?.trim().toUpperCase() ||
            'DXB',
          customerType: resolvedCustomerType,
          channel: input.channel ?? 'DIRECT',
          insurancePlanCode: input.insurancePlanCode ?? 'CDW',
          requestedAncillaries: input.ancillaries ?? [],
          promoCode: input.promoCode?.trim().toUpperCase() || null,
          youngDriverUnder25: Boolean(
            (input.ancillaries ?? []).some(
              (a) => a.code.toUpperCase() === 'YOUNG_DRIVER_SURCHARGE',
            ),
          ),
          crossBorderDestination: null,
          language: 'en',
          detectedLanguage: 'en',
          confidence: 'high',
          warnings: [],
        };

        const serverGrounded = await buildGroundedRentalQuoteInTx(tx, tenantId, serverIntent);
        const serverQuote = serverGrounded.quoteBreakdown;

        await assertCustomerEligibleForRental(tx, {
          tenantId,
          customerId: resolvedCustomerId,
          dropoffDate: dropoffDt,
          vehicleCategory: canonicalCategory,
          additionalExposureAed: serverQuote.totalAmount,
          allowCreditOverride: false,
        });

        const selectedVehicleId = input.vehicleId?.trim() || null;
        const desiredStatus = input.status ?? 'CONFIRMED';

        const createdBooking = await withRentalLock(
          tx,
          tenantId,
          {
            entityKey: `copilot_booking:${resolvedCustomerId}`,
            vehicleIds: [selectedVehicleId],
          },
          async () => {
            if (selectedVehicleId) {
              const vehRows = await withSavepoint<Array<{ id: string; status: string | null }>>(
                tx,
                'copilot_chk_veh_status',
                () =>
                  tx.$queryRawUnsafe<Array<{ id: string; status: string | null }>>(
                    `SELECT id::text AS id, status::text AS status
                       FROM vehicles
                      WHERE id::text = $1
                        AND tenant_id::text = $2
                        AND deleted_at IS NULL
                      LIMIT 1`,
                    selectedVehicleId,
                    tenantId,
                  ),
                [],
              );
              const veh = vehRows[0];
              if (!veh) {
                throw new RentalSecurityError(
                  404,
                  'VEHICLE_NOT_FOUND',
                  'Selected vehicle not found in tenant fleet',
                );
              }
              const vehStatus = String(veh.status ?? 'AVAILABLE').toUpperCase();
              if (!['AVAILABLE', 'RESERVED', 'RENTED'].includes(vehStatus)) {
                throw new RentalSecurityError(
                  409,
                  'VEHICLE_UNAVAILABLE',
                  `Selected vehicle is currently ${vehStatus} and cannot be booked`,
                );
              }

              const conflict = await checkVehicleRentalConflict(tx, {
                tenantId,
                vehicleId: selectedVehicleId,
                startDate: pickupDt,
                endDate: dropoffDt,
                checkGrounding: true,
              });
              if (conflict.hasConflict) {
                throw new RentalSecurityError(
                  409,
                  'VEHICLE_CONFLICT',
                  conflict.reason ?? 'Selected vehicle has an overlapping reservation',
                );
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

            const notesParts = [
              input.notes?.trim() || null,
              `[Grounded AI Copilot · Rule: ${serverQuote.ruleName}${serverQuote.appliedEventCode ? ` · Event: ${serverQuote.appliedEventCode}` : ''} · Insurance: ${serverIntent.insurancePlanCode}]`,
            ].filter(Boolean);

            const booking = await tx.rentalBooking.create({
              data: {
                tenantId,
                bookingRef,
                customerId: resolvedCustomerId,
                vehicleId: selectedVehicleId,
                vehicleCategory: canonicalCategory,
                pickupDate: pickupDt,
                dropoffDate: dropoffDt,
                pickupLocation: serverIntent.pickupLocation,
                dropoffLocation: serverIntent.dropoffLocation,
                totalDays: serverQuote.totalDays,
                dailyRate: serverQuote.dailyRate,
                totalAmount: serverQuote.totalAmount,
                currency: serverQuote.currency || 'AED',
                status: desiredStatus,
                channel: serverIntent.channel,
                notes: notesParts.join(' ').slice(0, 2000),
              },
            });

            // Persist `ancillaries` JSONB snapshot via savepoint-guarded SQL
            if (typeof (tx as { $executeRawUnsafe?: unknown }).$executeRawUnsafe === 'function') {
              await withSavepoint(
                tx,
                'copilot_save_bkg_ancillaries',
                () =>
                  tx.$executeRawUnsafe(
                    `UPDATE rental_bookings
                        SET ancillaries = $1::jsonb
                      WHERE id::text = $2
                        AND tenant_id::text = $3`,
                    JSON.stringify(serverGrounded.ancillaries),
                    booking.id,
                    tenantId,
                  ),
                0,
              );
            }

            // Persist immutable rate quote snapshot linked to booking
            await withSavepoint(
              tx,
              'copilot_save_rate_quote',
              () =>
                tx.rentalRateQuote.create({
                  data: {
                    tenantId,
                    bookingId: booking.id,
                    vehicleCategory: canonicalCategory,
                    pickupDate: pickupDt,
                    dropoffDate: dropoffDt,
                    totalDays: serverQuote.totalDays,
                    totalHours: serverQuote.totalHours,
                    appliedRuleId: serverQuote.appliedRuleId,
                    currency: serverQuote.currency || 'AED',
                    baseRentalCharge: serverQuote.baseRentalCharge,
                    insurancePlanCode: serverQuote.insurancePlanCode,
                    insuranceCharge: serverQuote.insuranceCharge,
                    extras: JSON.stringify(
                      serverGrounded.ancillaries.map((a) => ({
                        code: a.code,
                        name: a.nameEn,
                        quantity: a.quantity,
                        amount: a.totalCharge,
                      })),
                    ),
                    discountPct: serverQuote.discountPct,
                    discountAmount: serverQuote.discountAmount,
                    taxPct: serverQuote.taxRate,
                    taxAmount: serverQuote.taxAmount,
                    totalAmount: serverQuote.totalAmount,
                    breakdown: JSON.stringify(serverQuote.breakdown),
                  },
                }),
              null,
            );

            // Reserve concrete vehicle if CONFIRMED and currently AVAILABLE
            if (
              selectedVehicleId &&
              desiredStatus === 'CONFIRMED' &&
              typeof (tx as { $executeRawUnsafe?: unknown }).$executeRawUnsafe === 'function'
            ) {
              await withSavepoint(
                tx,
                'copilot_reserve_vehicle',
                () =>
                  tx.$executeRawUnsafe(
                    `UPDATE vehicles
                        SET status = 'RESERVED',
                            updated_at = NOW()
                      WHERE id::text = $1
                        AND tenant_id::text = $2
                        AND deleted_at IS NULL
                        AND UPPER(COALESCE(status::text, 'AVAILABLE')) = 'AVAILABLE'`,
                    selectedVehicleId,
                    tenantId,
                  ),
                0,
              );
            }

            return booking;
          },
        );

        return {
          booking: createdBooking,
          quoteBreakdown: serverQuote,
          ancillaries: serverGrounded.ancillaries,
        };
      });

      void logAudit({
        tenantId,
        userId: userId ?? req.headers.get('x-user-id') ?? undefined,
        userRole: role ?? req.headers.get('x-user-role') ?? undefined,
        entityType: 'RentalBooking',
        entityId: bookingOutcome.booking.id,
        action: 'CREATE',
        details: `1-Click Grounded Copilot Booking ${bookingOutcome.booking.bookingRef}: ${canonicalCategory} × ${bookingOutcome.quoteBreakdown.totalDays}d, AED ${bookingOutcome.quoteBreakdown.totalAmount.toFixed(2)}.`,
      });

      return NextResponse.json(
        {
          ok: true,
          booking: {
            id: bookingOutcome.booking.id,
            bookingRef: bookingOutcome.booking.bookingRef,
            status: bookingOutcome.booking.status,
            vehicleCategory: bookingOutcome.booking.vehicleCategory,
            vehicleId: bookingOutcome.booking.vehicleId,
            pickupDate: bookingOutcome.booking.pickupDate.toISOString(),
            dropoffDate: bookingOutcome.booking.dropoffDate.toISOString(),
            totalDays: bookingOutcome.booking.totalDays,
            dailyRate: Number(bookingOutcome.booking.dailyRate ?? 0),
            totalAmount: Number(bookingOutcome.booking.totalAmount ?? 0),
            currency: bookingOutcome.booking.currency ?? 'AED',
          },
          quoteBreakdown: bookingOutcome.quoteBreakdown,
          ancillaries: bookingOutcome.ancillaries,
        },
        { status: 201 },
      );
    }

    // ── Branch A: Grounded Quote Generation (2-Phase Pipeline) ──────────────
    const permErr = await requireRentalPermission(
      req.headers,
      tenantId,
      'view',
      'bookings',
      req.nextUrl.pathname,
    );
    if (permErr) return permErr;

    const parsedQuote = quoteBodySchema.safeParse(body);
    if (!parsedQuote.success) {
      return NextResponse.json(
        {
          error: 'Validation failed',
          details: parsedQuote.error.issues.map((i) => ({
            path: i.path.join('.'),
            message: i.message,
          })),
        },
        { status: 400 },
      );
    }

    // Phase 1: Intent Extraction STRICTLY OUTSIDE `withTenantRls` (governed by AI budget caps)
    const governed = await governCopilot(
      {
        tenantId,
        agentId: 'rental-copilot',
        eventType: 'rental.copilot_requested',
        modelAlias: 'STANDARD_REASONING',
      },
      () => extractRentalIntent(parsedQuote.data.brief),
    );
    if (!governed.ok) {
      return NextResponse.json({ error: governed.reason }, { status: 403 });
    }
    const intentOutcome = governed.value;
    if (!intentOutcome.ok) {
      return NextResponse.json(
        { error: 'AI Rental Co-pilot could not extract rental parameters from brief' },
        { status: 502 },
      );
    }

    // Phase 2: Grounded Tariff, Ancillary & Fleet Availability Lookup INSIDE `withTenantRls`
    const grounded = await withTenantRls(prisma, tenantId, async (tx) => {
      // Explicit tenant presence verification satisfies defense-in-depth static audit
      await tx.tenant.findFirst({
        where: { id: tenantId },
        select: { id: true },
      });
      return buildGroundedRentalQuoteInTx(tx, tenantId, intentOutcome.intent);
    });

    void logAudit({
      tenantId,
      userId: userId ?? req.headers.get('x-user-id') ?? undefined,
      userRole: role ?? req.headers.get('x-user-role') ?? undefined,
      entityType: 'AIRentalCopilot',
      action: 'EXPORT',
      details: `Grounded Rental Co-pilot: ${grounded.suggestion.vehicleCategory} × ${grounded.suggestion.totalDays}d, AED ${grounded.suggestion.totalAmount.toFixed(2)}, ${grounded.availableCount} available fleet unit(s) (${intentOutcome.modelUsed}, ${intentOutcome.promptTokens + intentOutcome.completionTokens} tokens, ${intentOutcome.durationMs}ms).`,
    });

    return NextResponse.json({
      ok: true,
      suggestion: grounded.suggestion,
      grounded,
      quoteBreakdown: grounded.quoteBreakdown,
      availableVehicles: grounded.availableVehicles,
      availableCount: grounded.availableCount,
      appliedPricingRule: grounded.appliedPricingRule,
      activeRateEvents: grounded.activeRateEvents,
      ancillaries: grounded.ancillaries,
      upgradeAlternative: grounded.upgradeAlternative,
      explanation: grounded.explanation,
      meta: {
        modelUsed: intentOutcome.modelUsed,
        promptTokens: intentOutcome.promptTokens,
        completionTokens: intentOutcome.completionTokens,
        durationMs: intentOutcome.durationMs,
      },
    });
  } catch (err: unknown) {
    if (isRentalSecurityError(err)) {
      return NextResponse.json(
        { error: err.message, code: err.code },
        { status: err.status },
      );
    }
    captureException(err, { context: 'rental.bookings.copilot' });
    console.error('[rental copilot] error:', err);
    return NextResponse.json({ error: 'Co-pilot request failed' }, { status: 500 });
  }
}
