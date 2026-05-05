/**
 * Shared helpers for pricing_rules raw SQL operations.
 * Replaces the need for prisma.pricingRule (Prisma model accessor)
 * which requires prisma generate to be re-run — something we can't
 * do from the sandbox since the client was built for Windows.
 */

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

// ── snake_case DB row → camelCase response object ─────────────────────────────
export function rowToCamel(row: Record<string, any>): Record<string, any> {
  const out: Record<string, any> = {};
  for (const [key, val] of Object.entries(row)) {
    const camel = key.replace(/_([a-z])/g, (_, c: string) => c.toUpperCase());
    out[camel] = val;
  }
  return out;
}

// ── camelCase body → INSERT columns/params/values ────────────────────────────
export function pricingRuleToRow(
  body: Record<string, any>,
  id: string,
  now: string,
): { cols: string; params: string; values: any[] } {
  const colList: string[]  = ['id', 'created_at', 'updated_at'];
  const values: any[]      = [id, now, now];
  let idx = 4;

  for (const [camel, snake] of Object.entries(PRICING_FIELD_MAP)) {
    if (body[camel] !== undefined && body[camel] !== null) {
      colList.push(snake);
      values.push(body[camel]);
      idx++;
    }
  }

  const cols   = colList.join(', ');
  const params = colList.map((_, i) => '$' + (i + 1)).join(', ');
  return { cols, params, values };
}

// ── camelCase body → UPDATE SET clause ───────────────────────────────────────
export function pricingRuleUpdateSet(
  body: Record<string, any>,
  now: string,
): { setClauses: string; values: any[]; nextIdx: number } {
  const setClauses: string[] = ['updated_at = $1'];
  const values: any[]        = [now];
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
