/**
 * XL AI Smart Mobility — Rental Rate Engine
 * Calculates the best-matching rate for a booking request,
 * applying seasonal multipliers, customer-type discounts,
 * location surcharges, promo codes, and insurance coverage.
 */

export interface RateRequest {
  vehicleCategory: string;
  pickupDate: Date;
  dropoffDate: Date;
  pickupLocationCode?: string;
  dropoffLocationCode?: string;
  customerType?: string;           // INDIVIDUAL|CORPORATE|AIRLINE|FREQUENT_FLYER|INSURANCE
  corporateAccountId?: string;
  airlineCode?: string;
  frequentFlyerNo?: string;
  creditCardType?: string;
  channel?: string;                // DIRECT|CORPORATE|AGENCY|ONLINE
  promoCode?: string;
  insurancePlanCode?: string;
  currency?: string;
  extraOptions?: { name: string; amount: number }[];
}

export interface RateBreakdownLine {
  label: string;
  qty: number;
  unitLabel: string;
  unitPrice: number;
  amount: number;
  type: string;
}

export interface RateResult {
  appliedRuleId: string | null;
  ruleName: string;
  vehicleCategory: string;
  totalDays: number;
  totalHours: number;
  currency: string;
  dailyRate: number;
  baseRentalCharge: number;
  insurancePlanCode: string | null;
  insuranceDailyRate: number;
  insuranceCharge: number;
  extraCharges: number;
  subtotal: number;
  promoCode: string | null;
  discountPct: number;
  discountAmount: number;
  taxablAmount: number;
  taxRate: number;
  taxAmount: number;
  totalAmount: number;
  breakdown: RateBreakdownLine[];
  gracePeriodMin: number;
  lateFeePerHour: number;
  lateFeeCap: number;
  includedKmPerDay: number;
  excessKmRate: number;
  appliedAt: string;
}

// ── helpers ───────────────────────────────────────────────────────────────────

function daysAndHours(from: Date, to: Date): { days: number; hours: number } {
  const ms = to.getTime() - from.getTime();
  const totalHours = Math.ceil(ms / (1000 * 60 * 60));
  const days = Math.ceil(totalHours / 24);
  return { days: Math.max(1, days), hours: totalHours };
}

function isInSeason(rule: any, date: Date): boolean {
  if (!rule.season_from && !rule.season_to) return true;
  const d = date.getTime();
  const from = rule.season_from ? new Date(rule.season_from).getTime() : 0;
  const to   = rule.season_to   ? new Date(rule.season_to).getTime()   : Infinity;
  return d >= from && d <= to;
}

function matchScore(rule: any, req: RateRequest): number {
  let score = 0;
  if (rule.customer_type && rule.customer_type !== req.customerType) return -1;
  if (rule.corporate_account_id && rule.corporate_account_id !== req.corporateAccountId) return -1;
  if (rule.airline_code && rule.airline_code !== req.airlineCode) return -1;
  if (rule.pickup_location_code && rule.pickup_location_code !== req.pickupLocationCode) return -1;
  if (rule.channel && rule.channel !== 'ALL' && rule.channel !== req.channel) return -1;
  if (rule.credit_card_type && rule.credit_card_type !== 'ANY' && rule.credit_card_type !== req.creditCardType) return -1;
  if (rule.promo_code && rule.promo_code !== req.promoCode) return -1;
  if (!isInSeason(rule, req.pickupDate)) return -1;

  // Score specificity
  if (rule.customer_type)          score += 10;
  if (rule.corporate_account_id)   score += 20;
  if (rule.airline_code)           score += 15;
  if (rule.pickup_location_code)   score += 8;
  if (rule.channel)                score += 5;
  if (rule.credit_card_type)       score += 6;
  if (rule.promo_code)             score += 25;
  if (rule.season_from)            score += 5;
  score += (rule.priority ?? 0) * 10;

  return score;
}

function pickBestRate(rules: any[], req: RateRequest): any | null {
  let best: any = null;
  let bestScore = -1;
  for (const r of rules) {
    if (!r.is_active) continue;
    if (r.vehicle_category !== req.vehicleCategory) continue;
    const s = matchScore(r, req);
    if (s >= 0 && s > bestScore) { best = r; bestScore = s; }
  }
  return best;
}

function resolveInsurancePlan(rule: any, planCode: string | undefined): { code: string; dailyRate: number } | null {
  if (!planCode || !rule?.insurance_plans) return null;
  try {
    const plans: { code: string; name: string; dailyRate: number }[] = JSON.parse(rule.insurance_plans);
    const match = plans.find(p => p.code === planCode);
    return match ? { code: match.code, dailyRate: Number(match.dailyRate) } : null;
  } catch { return null; }
}

// ── main export ───────────────────────────────────────────────────────────────

export function calculateRate(rules: any[], req: RateRequest): RateResult {
  const { days, hours } = daysAndHours(req.pickupDate, req.dropoffDate);
  const currency = req.currency ?? 'AED';
  const TAX_RATE = 5; // UAE VAT

  const rule = pickBestRate(rules, req);

  // Determine daily rate (weekly/monthly discounts)
  let dailyRate = rule ? Number(rule.base_daily_rate) : 0;
  if (rule) {
    const multiplier = Number(rule.multiplier ?? 1);
    if (days >= 28 && rule.monthly_rate)      dailyRate = Number(rule.monthly_rate) / 30;
    else if (days >= 7 && rule.weekly_rate)   dailyRate = Number(rule.weekly_rate)  / 7;
    dailyRate *= multiplier;

    // Online channel discount
    if (req.channel === 'ONLINE' && Number(rule.online_discount ?? 0) > 0) {
      dailyRate *= (1 - Number(rule.online_discount) / 100);
    }
  }

  const baseRentalCharge = parseFloat((dailyRate * days).toFixed(2));
  const breakdown: RateBreakdownLine[] = [];

  breakdown.push({
    label: `Vehicle rental — ${req.vehicleCategory} (${days} day${days > 1 ? 's' : ''})`,
    qty: days, unitLabel: 'day', unitPrice: dailyRate,
    amount: baseRentalCharge, type: 'RENTAL',
  });

  // Insurance
  const insurancePlan = resolveInsurancePlan(rule, req.insurancePlanCode);
  const insuranceDailyRate = insurancePlan ? insurancePlan.dailyRate : 0;
  const insuranceCharge    = parseFloat((insuranceDailyRate * days).toFixed(2));
  if (insuranceCharge > 0) {
    breakdown.push({
      label: `Insurance — ${insurancePlan!.code}`, qty: days,
      unitLabel: 'day', unitPrice: insuranceDailyRate,
      amount: insuranceCharge, type: 'INSURANCE',
    });
  }

  // Extra options (CDW, GPS, child seat, etc.)
  let extraCharges = 0;
  for (const ex of req.extraOptions ?? []) {
    extraCharges += ex.amount;
    breakdown.push({ label: ex.name, qty: 1, unitLabel: 'flat', unitPrice: ex.amount, amount: ex.amount, type: 'EXTRA' });
  }

  const subtotalBeforeDiscount = baseRentalCharge + insuranceCharge + extraCharges;

  // Promo discount
  let discountPct = 0;
  let discountAmount = 0;
  if (req.promoCode && rule?.promo_code === req.promoCode && Number(rule?.promo_discount_pct ?? 0) > 0) {
    const promoFrom = rule.promo_valid_from ? new Date(rule.promo_valid_from) : null;
    const promoTo   = rule.promo_valid_to   ? new Date(rule.promo_valid_to)   : null;
    const now = req.pickupDate;
    const promoValid = (!promoFrom || now >= promoFrom) && (!promoTo || now <= promoTo);
    const usesOk = !rule.promo_max_uses || (rule.promo_used_count ?? 0) < rule.promo_max_uses;
    if (promoValid && usesOk) {
      discountPct = Number(rule.promo_discount_pct);
      discountAmount = parseFloat((subtotalBeforeDiscount * discountPct / 100).toFixed(2));
      breakdown.push({ label: `Promo discount (${rule.promo_code}) -${discountPct}%`, qty: 1, unitLabel: 'flat', unitPrice: -discountAmount, amount: -discountAmount, type: 'DISCOUNT' });
    }
  }

  const subtotal    = parseFloat((subtotalBeforeDiscount - discountAmount).toFixed(2));
  const taxAmount   = parseFloat((subtotal * TAX_RATE / 100).toFixed(2));
  const totalAmount = parseFloat((subtotal + taxAmount).toFixed(2));

  breakdown.push({ label: `VAT (${TAX_RATE}%)`, qty: 1, unitLabel: 'flat', unitPrice: taxAmount, amount: taxAmount, type: 'TAX' });

  return {
    appliedRuleId:    rule?.id ?? null,
    ruleName:         rule?.name ?? 'Default',
    vehicleCategory:  req.vehicleCategory,
    totalDays:        days,
    totalHours:       hours,
    currency,
    dailyRate,
    baseRentalCharge,
    insurancePlanCode: insurancePlan?.code ?? null,
    insuranceDailyRate,
    insuranceCharge,
    extraCharges,
    subtotal,
    promoCode:    req.promoCode ?? null,
    discountPct,
    discountAmount,
    taxablAmount: subtotal,
    taxRate:      TAX_RATE,
    taxAmount,
    totalAmount,
    breakdown,
    gracePeriodMin:  Number(rule?.grace_period_min ?? 30),
    lateFeePerHour:  Number(rule?.late_fee_per_hour ?? 0),
    lateFeeCap:      Number(rule?.late_fee_cap ?? 0),
    includedKmPerDay: Number(rule?.included_km_per_day ?? 0),
    excessKmRate:    Number(rule?.excess_km_rate ?? 0),
    appliedAt:       new Date().toISOString(),
  };
}
