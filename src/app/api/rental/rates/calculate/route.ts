export const dynamic = 'force-dynamic';

/**
 * POST /api/rental/rates/calculate
 * Unified 1 Master Price List rate calculation endpoint.
 * Loads active PricingRules + seasonal/event RateEvents inside the tenant's
 * RLS transaction via `quoteRentalRateInTx`, returns full breakdown + yieldTrace,
 * and persists a 24h `rental_rate_quotes` snapshot with `tenant_id`.
 */
import { NextRequest, NextResponse } from 'next/server';
import { withTenantRls } from '@/lib/rls';
import { requireAuthorizedTenant, stripTenantOwnershipFields } from '@/lib/tenant-context';
import { prisma } from '@/lib/prisma';
import { quoteRentalRateInTx } from '@/lib/rental-rate-engine';
import { requireRentalPermission } from '@/lib/rental/rbac';
import {
  assertRentalForeignKeysInTenant,
  isRentalSecurityError,
} from '@/lib/rental/security-guards';

export async function POST(req: NextRequest) {
  const authz = requireAuthorizedTenant(req);
  if (!authz.ok) {
    return NextResponse.json({ error: authz.error }, { status: authz.status });
  }
  const { tenantId } = authz;

  const denied = await requireRentalPermission(
    req.headers,
    tenantId,
    'view',
    '*',
    req.nextUrl.pathname,
  );
  if (denied) return denied;

  let bodyRaw: unknown;
  try {
    bodyRaw = await req.json();
  } catch {
    return NextResponse.json({ error: 'Invalid JSON payload' }, { status: 400 });
  }
  if (!bodyRaw || typeof bodyRaw !== 'object' || Array.isArray(bodyRaw)) {
    return NextResponse.json({ error: 'Request body must be a JSON object' }, { status: 400 });
  }

  const body = stripTenantOwnershipFields(bodyRaw as Record<string, unknown>);
  const {
    vehicleCategory,
    pickupDate,
    dropoffDate,
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
    fleetUtilizationPct,
  } = body;

  if (!vehicleCategory || !pickupDate || !dropoffDate) {
    return NextResponse.json(
      { error: 'vehicleCategory, pickupDate and dropoffDate are required' },
      { status: 400 },
    );
  }

  const parsedPickup = new Date(String(pickupDate));
  const parsedDropoff = new Date(String(dropoffDate));
  if (Number.isNaN(parsedPickup.getTime()) || Number.isNaN(parsedDropoff.getTime())) {
    return NextResponse.json(
      { error: 'Invalid pickupDate or dropoffDate' },
      { status: 400 },
    );
  }
  if (parsedDropoff <= parsedPickup) {
    return NextResponse.json(
      { error: 'dropoffDate must be after pickupDate' },
      { status: 400 },
    );
  }

  let validatedExtras: { name: string; amount: number }[] | undefined;
  if (extraOptions !== undefined && extraOptions !== null) {
    if (!Array.isArray(extraOptions) || extraOptions.length > 50) {
      return NextResponse.json(
        { error: 'extraOptions must be an array of at most 50 items' },
        { status: 400 },
      );
    }
    validatedExtras = [];
    for (const item of extraOptions) {
      if (!item || typeof item !== 'object') {
        return NextResponse.json(
          { error: 'Each extraOptions entry must be an object with name and non-negative amount' },
          { status: 400 },
        );
      }
      const name = String((item as { name?: unknown }).name ?? '').trim();
      const amount = Number((item as { amount?: unknown }).amount);
      if (!name || !Number.isFinite(amount) || amount < 0) {
        return NextResponse.json(
          { error: 'extraOptions amounts must be finite non-negative numbers with a non-empty name' },
          { status: 400 },
        );
      }
      validatedExtras.push({ name: name.slice(0, 120), amount: Math.round(amount * 100) / 100 });
    }
  }

  let validatedUtilPct: number | undefined;
  if (fleetUtilizationPct != null && fleetUtilizationPct !== '') {
    const pct = Number(fleetUtilizationPct);
    if (!Number.isFinite(pct) || pct < 0 || pct > 100) {
      return NextResponse.json(
        { error: 'fleetUtilizationPct must be between 0 and 100' },
        { status: 400 },
      );
    }
    validatedUtilPct = pct;
  }

  const bookingId = body.bookingId ? String(body.bookingId).trim() : null;
  const corpId = corporateAccountId ? String(corporateAccountId).trim() : null;

  return withTenantRls(prisma, tenantId, async (tx) => {
    try {
      if (bookingId || corpId) {
        await assertRentalForeignKeysInTenant(tx, tenantId, {
          bookingId,
          corporateAccountId: corpId,
        });
      }

      const result = await quoteRentalRateInTx(tx, tenantId, {
        vehicleCategory: String(vehicleCategory),
        pickupDate: parsedPickup,
        dropoffDate: parsedDropoff,
        pickupLocationCode: pickupLocationCode ? String(pickupLocationCode) : undefined,
        dropoffLocationCode: dropoffLocationCode ? String(dropoffLocationCode) : undefined,
        customerType: customerType ? String(customerType) : undefined,
        corporateAccountId: corpId ?? undefined,
        airlineCode: airlineCode ? String(airlineCode) : undefined,
        frequentFlyerNo: frequentFlyerNo ? String(frequentFlyerNo) : undefined,
        creditCardType: creditCardType ? String(creditCardType) : undefined,
        channel: channel ? String(channel) : undefined,
        promoCode: promoCode ? String(promoCode) : undefined,
        insurancePlanCode: insurancePlanCode ? String(insurancePlanCode) : undefined,
        currency: currency ? String(currency) : undefined,
        extraOptions: validatedExtras,
        fleetUtilizationPct: validatedUtilPct,
      });

      // Persist as a quote snapshot (expires in 24 h) with id + tenant_id so RLS WITH CHECK passes.
      const quoteId = crypto.randomUUID();
      const expiresAt = new Date(Date.now() + 24 * 60 * 60 * 1000);
      try {
        await tx.$executeRawUnsafe('SAVEPOINT rental_quote_snapshot');
        await tx.$executeRawUnsafe(
          'INSERT INTO rental_rate_quotes ' +
            '(id, booking_id, vehicle_category, pickup_date, dropoff_date, total_days, total_hours, ' +
            'applied_rule_id, currency, base_rental_charge, insurance_plan_code, insurance_charge, ' +
            'extras, discount_pct, discount_amount, tax_pct, tax_amount, total_amount, breakdown, expires_at, tenant_id) ' +
            'VALUES ($1,$2,$3,$4::timestamptz,$5::timestamptz,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20::timestamptz,$21)',
          quoteId,
          bookingId,
          String(vehicleCategory),
          parsedPickup.toISOString(),
          parsedDropoff.toISOString(),
          result.totalDays,
          result.totalHours,
          result.appliedRuleId,
          result.currency,
          result.baseRentalCharge,
          result.insurancePlanCode,
          result.insuranceCharge,
          JSON.stringify(validatedExtras ?? []),
          result.discountPct,
          result.discountAmount,
          result.taxRate,
          result.taxAmount,
          result.totalAmount,
          JSON.stringify(result.breakdown),
          expiresAt.toISOString(),
          tenantId,
        );
        await tx.$executeRawUnsafe('RELEASE SAVEPOINT rental_quote_snapshot');
      } catch {
        // Rollback savepoint if quote table is mocked/unavailable so outer tx stays healthy
        await tx.$executeRawUnsafe('ROLLBACK TO SAVEPOINT rental_quote_snapshot').catch(() => {});
      }

      return NextResponse.json({ ...result, quoteId });
    } catch (e: unknown) {
      if (isRentalSecurityError(e)) {
        return NextResponse.json({ error: e.message, code: e.code }, { status: e.status });
      }
      console.error('Rate calculation error:', e);
      return NextResponse.json({ error: 'Calculation failed' }, { status: 500 });
    }
  });
}
