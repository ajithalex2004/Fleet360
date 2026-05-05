/**
 * POST /api/rental/rates/calculate
 * The rate engine endpoint. Takes a booking request and returns
 * a full price breakdown using the best-matching PricingRule.
 */
import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { calculateRate, type RateRequest } from '@/lib/rental-rate-engine';

export async function POST(req: NextRequest) {
  try {
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
    const rules = await prisma.$queryRawUnsafe<any[]>(
      "SELECT * FROM pricing_rules WHERE is_active = true ORDER BY priority DESC"
    );

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
      await prisma.$executeRawUnsafe(
        "INSERT INTO rental_rate_quotes " +
        "(booking_id, vehicle_category, pickup_date, dropoff_date, total_days, total_hours, " +
        "applied_rule_id, currency, base_rental_charge, insurance_plan_code, insurance_charge, " +
        "extras, discount_pct, discount_amount, tax_pct, tax_amount, total_amount, breakdown, expires_at) " +
        "VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19)",
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
    } catch (_) { /* non-fatal — quote still returned */ }

    return NextResponse.json(result);
  } catch (e: any) {
    console.error('Rate calculation error:', e);
    return NextResponse.json({ error: e.message ?? 'Calculation failed' }, { status: 500 });
  }
}
