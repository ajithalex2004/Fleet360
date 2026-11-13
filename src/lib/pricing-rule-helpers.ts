/**
 * Shared helpers for pricing_rules raw SQL operations.
 * Replaces the need for prisma.pricingRule (Prisma model accessor)
 * which requires prisma generate to be re-run — something we can't
 * do from the sandbox since the client was built for Windows.
 */

import { RentalSecurityError } from '@/lib/rental/security-guards';

// ── camelCase → snake_case field mapping ─────────────────────────────────────
export const PRICING_FIELD_MAP: Record<string, string> = {
  name:               'name',
  vehicleCategory:    'vehicle_category',
  baseDailyRate:      'base_daily_rate',
  baseKmRate:         'base_km_rate',
  baseHourlyRate:     'base_hourly_rate',
  weeklyRate:         'weekly_rate',
  monthlyRate:        'monthly_rate',
  weekendDailyRate:   'weekend_daily_rate',
  seasonFrom:         'season_from',
  seasonTo:           'season_to',
  multiplier:         'multiplier',
  currency:           'currency',
  exchangeRateToAed:  'exchange_rate_to_aed',
  customerType:       'customer_type',
  corporateAccountId: 'corporate_account_id',
  airlineCode:        'airline_code',
  frequentFlyerProg:  'frequent_flyer_prog',
  creditCardType:     'credit_card_type',
  pickupLocationCode: 'pickup_location_code',
  dropoffLocationCode:'dropoff_location_code',
  isAirportRate:      'is_airport_rate',
  isDomestic:         'is_domestic',
  channel:            'channel',
  onlineDiscount:     'online_discount',
  gracePeriodMin:     'grace_period_min',
  lateFeePerHour:     'late_fee_per_hour',
  lateFeeCap:         'late_fee_cap',
  minRentalDays:      'min_rental_days',
  minRentalHours:     'min_rental_hours',
  insurancePlans:     'insurance_plans',
  promoCode:          'promo_code',
  promoDiscountPct:   'promo_discount_pct',
  promoValidFrom:     'promo_valid_from',
  promoValidTo:       'promo_valid_to',
  promoMaxUses:       'promo_max_uses',
  promoUsedCount:     'promo_used_count',
  includedKmPerDay:   'included_km_per_day',
  excessKmRate:       'excess_km_rate',
  priority:           'priority',
  isActive:           'is_active',
  taxRate:            'tax_rate',
  notes:              'notes',
};

const NON_NEGATIVE_NUMERIC_FIELDS = [
  'baseDailyRate',
  'baseKmRate',
  'baseHourlyRate',
  'weeklyRate',
  'monthlyRate',
  'weekendDailyRate',
  'gracePeriodMin',
  'lateFeePerHour',
  'lateFeeCap',
  'minRentalDays',
  'minRentalHours',
  'promoMaxUses',
  'promoUsedCount',
  'includedKmPerDay',
  'excessKmRate',
] as const;

const PERCENTAGE_FIELDS = [
  'onlineDiscount',
  'promoDiscountPct',
  'taxRate',
] as const;

/**
 * Validates numeric bounds and date ranges on pricing_rules payloads so negative
 * rates, >100% discounts, non-positive multipliers, or inverted date windows are rejected.
 */
export function validatePricingRuleFields(body: Record<string, unknown>): void {
  for (const field of NON_NEGATIVE_NUMERIC_FIELDS) {
    const raw = body[field];
    if (raw !== undefined && raw !== null && raw !== '') {
      const n = Number(raw);
      if (!Number.isFinite(n) || n < 0) {
        throw new RentalSecurityError(
          400,
          'INVALID_PRICING_FIELD',
          `${field} must be a finite non-negative number`,
        );
      }
    }
  }

  for (const field of PERCENTAGE_FIELDS) {
    const raw = body[field];
    if (raw !== undefined && raw !== null && raw !== '') {
      const n = Number(raw);
      if (!Number.isFinite(n) || n < 0 || n > 100) {
        throw new RentalSecurityError(
          400,
          'INVALID_PRICING_FIELD',
          `${field} must be between 0 and 100`,
        );
      }
    }
  }

  if (body.multiplier !== undefined && body.multiplier !== null && body.multiplier !== '') {
    const mult = Number(body.multiplier);
    if (!Number.isFinite(mult) || mult <= 0 || mult > 20) {
      throw new RentalSecurityError(
        400,
        'INVALID_PRICING_FIELD',
        'multiplier must be greater than 0 and at most 20',
      );
    }
  }

  if (
    body.exchangeRateToAed !== undefined &&
    body.exchangeRateToAed !== null &&
    body.exchangeRateToAed !== ''
  ) {
    const fx = Number(body.exchangeRateToAed);
    if (!Number.isFinite(fx) || fx <= 0) {
      throw new RentalSecurityError(
        400,
        'INVALID_PRICING_FIELD',
        'exchangeRateToAed must be greater than 0',
      );
    }
  }

  if (body.priority !== undefined && body.priority !== null && body.priority !== '') {
    const prio = Number(body.priority);
    if (!Number.isFinite(prio) || !Number.isInteger(prio) || prio < -1000 || prio > 10000) {
      throw new RentalSecurityError(
        400,
        'INVALID_PRICING_FIELD',
        'priority must be an integer between -1000 and 10000',
      );
    }
  }

  if (body.seasonFrom && body.seasonTo) {
    const from = new Date(String(body.seasonFrom));
    const to = new Date(String(body.seasonTo));
    if (Number.isNaN(from.getTime()) || Number.isNaN(to.getTime()) || to < from) {
      throw new RentalSecurityError(
        400,
        'INVALID_PRICING_DATES',
        'seasonTo must be a valid date on or after seasonFrom',
      );
    }
  }

  if (body.promoValidFrom && body.promoValidTo) {
    const from = new Date(String(body.promoValidFrom));
    const to = new Date(String(body.promoValidTo));
    if (Number.isNaN(from.getTime()) || Number.isNaN(to.getTime()) || to < from) {
      throw new RentalSecurityError(
        400,
        'INVALID_PRICING_DATES',
        'promoValidTo must be a valid date on or after promoValidFrom',
      );
    }
  }
}

// ── snake_case DB row → camelCase response object ─────────────────────────────
export function rowToCamel(row: Record<string, unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [key, val] of Object.entries(row)) {
    const camel = key.replace(/_([a-z])/g, (_, c: string) => c.toUpperCase());
    out[camel] = val;
  }
  return out;
}

// ── camelCase body → INSERT columns/params/values ────────────────────────────
export function pricingRuleToRow(
  body: Record<string, unknown>,
  id: string,
  now: string,
  tenantId: string,
): { cols: string; params: string; values: unknown[] } {
  const normalizedTenantId = typeof tenantId === 'string' ? tenantId.trim() : '';
  if (!normalizedTenantId) {
    throw new RentalSecurityError(
      400,
      'MISSING_TENANT_ID',
      'tenantId is required when creating a pricing rule',
    );
  }

  validatePricingRuleFields(body);

  const colList: string[] = ['id', 'tenant_id', 'created_at', 'updated_at'];
  const values: unknown[] = [id, normalizedTenantId, now, now];

  for (const [camel, snake] of Object.entries(PRICING_FIELD_MAP)) {
    if (body[camel] !== undefined && body[camel] !== null) {
      colList.push(snake);
      values.push(body[camel]);
    }
  }

  const cols   = colList.join(', ');
  const params = colList.map((_, i) => '$' + (i + 1)).join(', ');
  return { cols, params, values };
}

// ── camelCase body → UPDATE SET clause ───────────────────────────────────────
export function pricingRuleUpdateSet(
  body: Record<string, unknown>,
  now: string,
): { setClauses: string; values: unknown[]; nextIdx: number } {
  validatePricingRuleFields(body);

  const setClauses: string[] = ['updated_at = $1'];
  const values: unknown[]    = [now];
  let idx = 2;

  for (const [camel, snake] of Object.entries(PRICING_FIELD_MAP)) {
    if (body[camel] !== undefined) {
      setClauses.push(snake + ' = $' + idx);
      values.push(body[camel]);
      idx++;
    }
  }

  return { setClauses: setClauses.join(', '), values, nextIdx: idx };
}
