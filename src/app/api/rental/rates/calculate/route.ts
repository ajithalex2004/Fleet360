/**
 * POST /api/rental/rates/calculate
 * The rate engine endpoint. Takes a booking request and returns
 * a full price breakdown using the best-matching PricingRule.
 */
import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { attachTenantToEntity, requireOperationalContext } from '@/lib/cross-module-governance';
import { calculateRate, type RateRequest } from '@/lib/rental-rate-engine';
import { ensureRentalGovernance } from '@/lib/rental-governance';

export async function POST(req: NextRequest) {
  await ensureRentalGovernance();
  try {
    const ctx = requireOperationalContext(req, 'rac');
    if (ctx instanceof NextResponse) return ctx;
    const body = await req.json();
    const {
      vehicleCategory, pickupDate, dropoffDate,
      pickupLocationCode, dropoffLocationCode,
      customerType, corporateAccountId, airlineCode,
      frequentFlyerNo, creditCardType, channel,
      promoCode, insurancePlanCode, currency, extraOptions,
    } = body;

    if (!vehicleCategory || !pickupDate || !dropoffDate) {
      return NextResponse.json(
        { error: 'vehicleCategory, pickupDate and dropoffDate are required' },
        { status: 400 },
      );
    }

    // Fetch all active rules ordered by priority (raw SQL — avoids stale Prisma client)
    const rules = await prisma.$queryRawUnsafe<Array<Record<string, unknown>>>(
      `SELECT *
         FROM pricing_rules
        WHERE is_active = true
          AND (tenant_id::text = $1 OR tenant_id IS NULL OR tenant_id::text = 'GLOBAL')
        ORDER BY priority DESC`,
      ctx.tenantId,
    );

    if (body.bookingId) {
      const bookingRows = await prisma.$queryRawUnsafe<Array<{ id: string }>>(
        `SELECT id::text
           FROM rental_bookings
          WHERE id = $1
            AND tenant_id::text = $2
            AND deleted_at IS NULL
          LIMIT 1`,
        body.bookingId,
        ctx.tenantId,
      ).catch(() => []);
      if (!bookingRows[0]) {
        return NextResponse.json({ error: 'Booking not found for tenant' }, { status: 404 });
      }
    }

    const rateReq: RateRequest = {
      vehicleCategory,
      pickupDate:    new Date(pickupDate),
      dropoffDate:   new Date(dropoffDate),
      pickupLocationCode,
      dropoffLocationCode,
      customerType,
      corporateAccountId,
      airlineCode,
      frequentFlyerNo,
      creditCardType,
      channel,
      promoCode,
      insurancePlanCode,
      currency,
      extraOptions,
    };

    const result = calculateRate(rules, rateReq);

    // Persist as a quote snapshot (expires in 24 h)
    const expiresAt = new Date(Date.now() + 24 * 60 * 60 * 1000);
    try {
      const quoteId = crypto.randomUUID();
      await prisma.$executeRawUnsafe(
        "INSERT INTO rental_rate_quotes " +
        "(id, booking_id, vehicle_category, pickup_date, dropoff_date, total_days, total_hours, " +
        "applied_rule_id, currency, base_rental_charge, insurance_plan_code, insurance_charge, " +
        "extras, discount_pct, discount_amount, tax_pct, tax_amount, total_amount, breakdown, expires_at) " +
        "VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20)",
        quoteId,
        body.bookingId ?? null,
        vehicleCategory,
        new Date(pickupDate).toISOString(),
        new Date(dropoffDate).toISOString(),
        result.totalDays,
        result.totalHours,
        result.appliedRuleId,
        result.currency,
        result.baseRentalCharge,
        result.insurancePlanCode,
        result.insuranceCharge,
        JSON.stringify(extraOptions ?? []),
        result.discountPct,
        result.discountAmount,
        result.taxRate,
        result.taxAmount,
        result.totalAmount,
        JSON.stringify(result.breakdown),
        expiresAt.toISOString(),
      );
      await attachTenantToEntity('rental_rate_quotes', quoteId, ctx.tenantId).catch(() => {});
    } catch { /* non-fatal — quote still returned */ }

    return NextResponse.json(result);
  } catch (e: unknown) {
    console.error('Rate calculation error:', e);
    return NextResponse.json({ error: e instanceof Error ? e.message : 'Calculation failed' }, { status: 500 });
  }
}
