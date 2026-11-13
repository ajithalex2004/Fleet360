/**
 * Fleet360 — Unified Master Rental Rate & Yield Engine (1 Price List)
 *
 * Consolidates tariff matching (`pricing_rules` — corporate accounts, customer
 * segments, weekly/monthly tiers, promos, insurance, excess-km, late-return
 * grace/fees) with dynamic `RateEvent` seasonal/event surcharges and optional
 * `YieldEngine` utilization/weekend adjustments.
 *
 * Accepts BOTH `snake_case` SQL rows (`SELECT * FROM pricing_rules`) and
 * `camelCase` Prisma / API objects so no caller ever silently evaluates to 0.
 */

import type { TxClient } from '@/lib/rls';
import {
  categoriesMatch,
  countWeekendDays,
  normalizeRentalCategory,
  pickApplicableRateEvent,
  type RateEventSnapshot,
  type YieldLayer,
} from '@/lib/rental-yield-engine';
import { withSavepoint } from '@/lib/rental/locks';

export { normalizeRentalCategory, categoriesMatch };

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
  /** Optional active RateEvent calendar rows from `/rental/rates/events` */
  events?: RateEventSnapshot[];
  /** Optional inline/direct RateEvent descriptors (multiplier + optional flatSurcharge) */
  rateEvents?: Array<{
    id?: string;
    eventCode?: string;
    name: string;
    dateFrom?: Date | string;
    dateTo?: Date | string;
    multiplier: number;
    flatSurcharge?: number | null;
    applicableCategories?: string | null;
    applicableChannels?: string | null;
    priority?: number;
    isActive?: boolean;
  }>;
  /** Optional live category utilization (0-100) for yield surge/discount */
  fleetUtilizationPct?: number;
  /** Total active vehicles in the category (used for >= 5 minimum fleet threshold on surge) */
  totalCategoryFleet?: number;
  /** Enable automatic LoR step-discount & default weekend uplift fallbacks when rule lacks explicit tiers */
  enableYieldLayers?: boolean;
  /** Enable live category utilization surge (>=85% -> +10%, >=92% -> +18%); defaults to true */
  enableUtilizationSurge?: boolean;
}

export type RateQuoteInput = RateRequest;

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
  appliedEventCode?: string | null;
  appliedEventName?: string | null;
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
  yieldTrace?: YieldLayer[];
  gracePeriodMin: number;
  lateFeePerHour: number;
  lateFeeCap: number;
  includedKmPerDay: number;
  excessKmRate: number;
  appliedAt: string;
}

export interface PricingRuleRow {
  id: string;
  name?: string | null;
  vehicle_category?: string;
  vehicleCategory?: string;
  base_daily_rate?: string | number;
  baseDailyRate?: string | number;
  monthly_rate?: string | number | null;
  monthlyRate?: string | number | null;
  weekly_rate?: string | number | null;
  weeklyRate?: string | number | null;
  weekend_daily_rate?: string | number | null;
  weekendDailyRate?: string | number | null;
  multiplier?: string | number | null;
  online_discount?: string | number | null;
  onlineDiscount?: string | number | null;
  season_from?: string | Date | null;
  seasonFrom?: string | Date | null;
  season_to?: string | Date | null;
  seasonTo?: string | Date | null;
  customer_type?: string | null;
  customerType?: string | null;
  corporate_account_id?: string | null;
  corporateAccountId?: string | null;
  airline_code?: string | null;
  airlineCode?: string | null;
  pickup_location_code?: string | null;
  pickupLocationCode?: string | null;
  channel?: string | null;
  credit_card_type?: string | null;
  creditCardType?: string | null;
  promo_code?: string | null;
  promoCode?: string | null;
  promo_discount_pct?: string | number | null;
  promoDiscountPct?: string | number | null;
  promo_valid_from?: string | Date | null;
  promoValidFrom?: string | Date | null;
  promo_valid_to?: string | Date | null;
  promoValidTo?: string | Date | null;
  promo_max_uses?: number | null;
  promoMaxUses?: number | null;
  promo_used_count?: number | null;
  promoUsedCount?: number | null;
  priority?: number | null;
  is_active?: boolean | null;
  isActive?: boolean | null;
  insurance_plans?: string | null;
  insurancePlans?: string | null;
  grace_period_min?: number | null;
  gracePeriodMin?: number | null;
  late_fee_per_hour?: string | number | null;
  lateFeePerHour?: string | number | null;
  late_fee_cap?: string | number | null;
  lateFeeCap?: string | number | null;
  included_km_per_day?: number | null;
  includedKmPerDay?: number | null;
  excess_km_rate?: string | number | null;
  excessKmRate?: string | number | null;
}

interface NormalizedPricingRule {
  id: string;
  name: string | null;
  vehicle_category: string;
  base_daily_rate: number;
  monthly_rate: number | null;
  weekly_rate: number | null;
  weekend_daily_rate: number | null;
  multiplier: number;
  online_discount: number;
  season_from: string | Date | null;
  season_to: string | Date | null;
  customer_type: string | null;
  corporate_account_id: string | null;
  airline_code: string | null;
  pickup_location_code: string | null;
  channel: string | null;
  credit_card_type: string | null;
  promo_code: string | null;
  promo_discount_pct: number;
  promo_valid_from: string | Date | null;
  promo_valid_to: string | Date | null;
  promo_max_uses: number | null;
  promo_used_count: number;
  priority: number;
  is_active: boolean;
  insurance_plans: string | null;
  grace_period_min: number;
  late_fee_per_hour: number;
  late_fee_cap: number;
  included_km_per_day: number;
  excess_km_rate: number;
}

export function normalizePricingRuleRow(r: PricingRuleRow): NormalizedPricingRule {
  const numOrNull = (v: unknown): number | null =>
    v === null || v === undefined || v === '' ? null : Number(v);
  return {
    id: String(r.id),
    name: r.name ?? null,
    vehicle_category: String(r.vehicle_category ?? r.vehicleCategory ?? ''),
    base_daily_rate: Number(r.base_daily_rate ?? r.baseDailyRate ?? 0),
    monthly_rate: numOrNull(r.monthly_rate ?? r.monthlyRate),
    weekly_rate: numOrNull(r.weekly_rate ?? r.weeklyRate),
    weekend_daily_rate: numOrNull(r.weekend_daily_rate ?? r.weekendDailyRate),
    multiplier: Number(r.multiplier ?? 1),
    online_discount: Number(r.online_discount ?? r.onlineDiscount ?? 0),
    season_from: r.season_from ?? r.seasonFrom ?? null,
    season_to: r.season_to ?? r.seasonTo ?? null,
    customer_type: r.customer_type ?? r.customerType ?? null,
    corporate_account_id: r.corporate_account_id ?? r.corporateAccountId ?? null,
    airline_code: r.airline_code ?? r.airlineCode ?? null,
    pickup_location_code: r.pickup_location_code ?? r.pickupLocationCode ?? null,
    channel: r.channel ?? null,
    credit_card_type: r.credit_card_type ?? r.creditCardType ?? null,
    promo_code: r.promo_code ?? r.promoCode ?? null,
    promo_discount_pct: Number(r.promo_discount_pct ?? r.promoDiscountPct ?? 0),
    promo_valid_from: r.promo_valid_from ?? r.promoValidFrom ?? null,
    promo_valid_to: r.promo_valid_to ?? r.promoValidTo ?? null,
    promo_max_uses: numOrNull(r.promo_max_uses ?? r.promoMaxUses),
    promo_used_count: Number(r.promo_used_count ?? r.promoUsedCount ?? 0),
    priority: Number(r.priority ?? 0),
    is_active: (r.is_active ?? r.isActive ?? true) !== false,
    insurance_plans: r.insurance_plans ?? r.insurancePlans ?? null,
    grace_period_min: Number(r.grace_period_min ?? r.gracePeriodMin ?? 30),
    late_fee_per_hour: Number(r.late_fee_per_hour ?? r.lateFeePerHour ?? 0),
    late_fee_cap: Number(r.late_fee_cap ?? r.lateFeeCap ?? 0),
    included_km_per_day: Number(r.included_km_per_day ?? r.includedKmPerDay ?? 250),
    excess_km_rate: Number(r.excess_km_rate ?? r.excessKmRate ?? 0),
  };
}

function daysAndHours(from: Date, to: Date): { days: number; hours: number } {
  const ms = to.getTime() - from.getTime();
  const totalHours = Math.ceil(ms / (1000 * 60 * 60));
  const days = Math.ceil(totalHours / 24);
  return { days: Math.max(1, days), hours: Math.max(1, totalHours) };
}

function isInSeason(rule: NormalizedPricingRule, date: Date): boolean {
  if (!rule.season_from && !rule.season_to) return true;
  const d = date.getTime();
  const from = rule.season_from ? new Date(rule.season_from).getTime() : 0;
  const to = rule.season_to ? new Date(rule.season_to).getTime() : Infinity;
  return d >= from && d <= to;
}

function matchScore(rule: NormalizedPricingRule, req: RateRequest): number {
  let score = 0;
  if (rule.customer_type && rule.customer_type !== 'ALL' && rule.customer_type !== req.customerType) return -1;
  if (rule.corporate_account_id && rule.corporate_account_id !== req.corporateAccountId) return -1;
  if (rule.airline_code && rule.airline_code !== req.airlineCode) return -1;
  if (rule.pickup_location_code && rule.pickup_location_code !== req.pickupLocationCode) return -1;
  if (rule.channel && rule.channel !== 'ALL' && rule.channel !== req.channel) return -1;
  if (rule.credit_card_type && rule.credit_card_type !== 'ANY' && rule.credit_card_type !== req.creditCardType) return -1;
  if (rule.promo_code && rule.promo_code !== req.promoCode) return -1;
  if (!isInSeason(rule, req.pickupDate)) return -1;

  // Exact category string gets a slight specificity tie-breaker over synonym match
  if (rule.vehicle_category.toUpperCase() === req.vehicleCategory.toUpperCase()) score += 4;

  if (rule.customer_type && rule.customer_type !== 'ALL') score += 10;
  if (rule.corporate_account_id) score += 20;
  if (rule.airline_code) score += 15;
  if (rule.pickup_location_code) score += 8;
  if (rule.channel && rule.channel !== 'ALL') score += 5;
  if (rule.credit_card_type && rule.credit_card_type !== 'ANY') score += 6;
  if (rule.promo_code) score += 25;
  if (rule.season_from) score += 5;
  score += (rule.priority ?? 0) * 10;

  return score;
}

function pickBestRate(rules: NormalizedPricingRule[], req: RateRequest): NormalizedPricingRule | null {
  let best: NormalizedPricingRule | null = null;
  let bestScore = -1;
  for (const r of rules) {
    if (!r.is_active) continue;
    if (!categoriesMatch(r.vehicle_category, req.vehicleCategory)) continue;
    const s = matchScore(r, req);
    if (s >= 0 && s > bestScore) {
      best = r;
      bestScore = s;
    }
  }
  return best;
}

function resolveInsurancePlan(
  rule: NormalizedPricingRule | null,
  planCode: string | undefined,
): { code: string; dailyRate: number } | null {
  if (!planCode || !rule?.insurance_plans) return null;
  try {
    const plans: { code: string; name: string; dailyRate: number }[] = JSON.parse(rule.insurance_plans);
    const match = plans.find((p) => p.code === planCode);
    return match ? { code: match.code, dailyRate: Number(match.dailyRate) } : null;
  } catch {
    return null;
  }
}

export function calculateRate(rawRules: PricingRuleRow[], req: RateRequest): RateResult {
  const rules = (rawRules ?? []).map(normalizePricingRuleRow);
  const { days, hours } = daysAndHours(req.pickupDate, req.dropoffDate);
  const currency = req.currency ?? 'AED';
  const TAX_RATE = 5; // UAE VAT 5%

  const rule = pickBestRate(rules, req);
  const yieldTrace: YieldLayer[] = [];

  // 1. Base daily rate (with weekly/monthly tiers + seasonal rule multiplier)
  let dailyRate = rule ? rule.base_daily_rate : 0;
  const rawBaseRate = dailyRate;
  const hasExplicitMonthly = Boolean(rule && days >= 28 && rule.monthly_rate);
  const hasExplicitWeekly = Boolean(rule && !hasExplicitMonthly && days >= 7 && rule.weekly_rate);

  if (rule) {
    if (hasExplicitMonthly) dailyRate = rule.monthly_rate! / 30;
    else if (hasExplicitWeekly) dailyRate = rule.weekly_rate! / 7;
    dailyRate *= rule.multiplier || 1;

    if (req.channel === 'ONLINE' && rule.online_discount > 0) {
      dailyRate *= 1 - rule.online_discount / 100;
    }
  }

  yieldTrace.push({
    layer: 'BASE',
    label: rule ? `Tariff · ${rule.name ?? rule.vehicle_category}` : 'Unmatched category (AED 0)',
    multiplier: rawBaseRate > 0 ? Number((dailyRate / rawBaseRate).toFixed(4)) : 1,
    dailyRateBefore: rawBaseRate,
    dailyRateAfter: Number(dailyRate.toFixed(2)),
    rationale: rule
      ? `Matched tariff "${rule.name ?? rule.vehicle_category}" for ${days} day(s).`
      : `No active tariff configured in /rental/rates for ${req.vehicleCategory}.`,
  });

  // 1b. Optional Length-of-Rental (LoR) step-discount fallback when tariff lacks explicit weekly/monthly rates
  if (
    req.enableYieldLayers === true &&
    !rule?.monthly_rate &&
    !rule?.weekly_rate &&
    dailyRate > 0
  ) {
    const lorDiscountPct = days >= 30 ? 25 : days >= 14 ? 15 : days >= 7 ? 10 : days >= 3 ? 5 : 0;
    if (lorDiscountPct > 0) {
      const before = dailyRate;
      const m = 1 - lorDiscountPct / 100;
      dailyRate = dailyRate * m;
      yieldTrace.push({
        layer: 'LOR',
        label: `Length-of-rental discount -${lorDiscountPct}%`,
        multiplier: Number(m.toFixed(4)),
        dailyRateBefore: Number(before.toFixed(2)),
        dailyRateAfter: Number(dailyRate.toFixed(2)),
        rationale: `${days}-day booking qualifies for ${lorDiscountPct}% LoR fallback step.`,
      });
    }
  }

  // 1c. Proportional UAE Weekend (Fri/Sat) uplift on daily rate (when not on weekly/monthly tier)
  if (!hasExplicitMonthly && !hasExplicitWeekly && dailyRate > 0) {
    const weekendDays = countWeekendDays(req.pickupDate, days);
    if (
      rule?.weekend_daily_rate != null &&
      rule.weekend_daily_rate > rule.base_daily_rate &&
      rule.base_daily_rate > 0 &&
      weekendDays > 0
    ) {
      const before = dailyRate;
      const fullWeekendUplift = rule.weekend_daily_rate / rule.base_daily_rate - 1;
      const weekendMult = 1 + (fullWeekendUplift * weekendDays) / days;
      dailyRate = dailyRate * weekendMult;
      yieldTrace.push({
        layer: 'WEEKEND',
        label: `Weekend uplift (${weekendDays}/${days} weekend days)`,
        multiplier: Number(weekendMult.toFixed(4)),
        dailyRateBefore: Number(before.toFixed(2)),
        dailyRateAfter: Number(dailyRate.toFixed(2)),
        rationale: `${weekendDays} Fri/Sat day(s) out of ${days} priced at weekend tariff AED ${rule.weekend_daily_rate.toFixed(2)}/day.`,
      });
    } else if (req.enableYieldLayers === true && weekendDays > 0) {
      const before = dailyRate;
      const weekendMult = 1 + (0.1 * weekendDays) / days;
      dailyRate = dailyRate * weekendMult;
      yieldTrace.push({
        layer: 'WEEKEND',
        label: `Weekend uplift (${weekendDays}/${days} weekend days)`,
        multiplier: Number(weekendMult.toFixed(4)),
        dailyRateBefore: Number(before.toFixed(2)),
        dailyRateAfter: Number(dailyRate.toFixed(2)),
        rationale: `${weekendDays} Fri/Sat day(s) out of ${days} carry +10% proportional weekend uplift.`,
      });
    }
  }

  // 2. Unified RateEvent calendar surge/discount + optional flatSurcharge (Eid, DSF, F1, Summer promo)
  const mergedEvents: RateEventSnapshot[] = [
    ...(req.events ?? []),
    ...(req.rateEvents ?? []).map((ev, idx) => ({
      id: ev.id ?? `inline-ev-${idx}`,
      eventCode: ev.eventCode ?? ev.name,
      name: ev.name,
      dateFrom:
        ev.dateFrom instanceof Date
          ? ev.dateFrom
          : new Date(ev.dateFrom ?? req.pickupDate),
      dateTo:
        ev.dateTo instanceof Date
          ? ev.dateTo
          : new Date(ev.dateTo ?? req.dropoffDate),
      multiplier: Number(ev.multiplier ?? 1),
      flatSurcharge: ev.flatSurcharge ?? 0,
      applicableCategories: ev.applicableCategories ?? null,
      applicableChannels: ev.applicableChannels ?? null,
      priority: ev.priority ?? 0,
      isActive: ev.isActive !== false,
    })),
  ];

  let appliedEvent: RateEventSnapshot | null = null;
  if (mergedEvents.length > 0 && dailyRate > 0) {
    appliedEvent = pickApplicableRateEvent(mergedEvents, {
      vehicleCategory: req.vehicleCategory,
      pickupDate: req.pickupDate,
      dropoffDate: req.dropoffDate,
      channel: req.channel,
    });
    if (appliedEvent) {
      const evMult = Number(appliedEvent.multiplier ?? 1);
      const evFlat = Math.max(0, Number(appliedEvent.flatSurcharge ?? 0));
      if (evMult !== 1 || evFlat > 0) {
        const before = dailyRate;
        if (evMult !== 1) {
          dailyRate = dailyRate * evMult;
        }
        const pct = ((evMult - 1) * 100).toFixed(1);
        const flatLabel = evFlat > 0 ? ` + AED ${evFlat.toFixed(2)}` : '';
        yieldTrace.push({
          layer: 'EVENT',
          label: `${appliedEvent.name} (${evMult >= 1 ? '+' : ''}${pct}%${flatLabel})`,
          multiplier: evMult,
          dailyRateBefore: Number(before.toFixed(2)),
          dailyRateAfter: Number(dailyRate.toFixed(2)),
          rationale: `Active rate event "${appliedEvent.eventCode}" overlaps booking window${evFlat > 0 ? ` with AED ${evFlat.toFixed(2)} flat surcharge` : ''}.`,
        });
      }
    }
  }

  // 3. Live fleet-utilization surge (>=85% -> +10%, >=92% -> +18%; requires category fleet >= 5 when known)
  if (
    req.enableUtilizationSurge !== false &&
    req.fleetUtilizationPct != null &&
    dailyRate > 0 &&
    (req.totalCategoryFleet === undefined || req.totalCategoryFleet >= 5)
  ) {
    const u = Math.min(100, Math.max(0, req.fleetUtilizationPct));
    const surgeMult = u >= 92 ? 1.18 : u >= 85 ? 1.1 : 1;
    if (surgeMult > 1) {
      const before = dailyRate;
      const surgePct = Math.round((surgeMult - 1) * 100);
      dailyRate = dailyRate * surgeMult;
      yieldTrace.push({
        layer: 'UTILIZATION',
        label: `High-utilization surge +${surgePct}%`,
        multiplier: surgeMult,
        dailyRateBefore: Number(before.toFixed(2)),
        dailyRateAfter: Number(dailyRate.toFixed(2)),
        rationale: `Category utilization is ${u}% (${u >= 92 ? '≥ 92%' : '≥ 85%'} threshold).`,
      });
    }
  }

  dailyRate = parseFloat(dailyRate.toFixed(2));
  const eventFlatSurcharge = appliedEvent
    ? parseFloat(Math.max(0, Number(appliedEvent.flatSurcharge ?? 0)).toFixed(2))
    : 0;
  const rentalDaysCharge = parseFloat((dailyRate * days).toFixed(2));
  const baseRentalCharge = parseFloat((rentalDaysCharge + eventFlatSurcharge).toFixed(2));
  const breakdown: RateBreakdownLine[] = [];

  breakdown.push({
    label: `Vehicle rental — ${req.vehicleCategory} (${days} day${days > 1 ? 's' : ''})${appliedEvent ? ` [${appliedEvent.name}]` : ''}`,
    qty: days,
    unitLabel: 'day',
    unitPrice: dailyRate,
    amount: rentalDaysCharge,
    type: 'RENTAL',
  });

  if (eventFlatSurcharge > 0 && appliedEvent) {
    breakdown.push({
      label: `Event surcharge — ${appliedEvent.name}`,
      qty: 1,
      unitLabel: 'flat',
      unitPrice: eventFlatSurcharge,
      amount: eventFlatSurcharge,
      type: 'EVENT_SURCHARGE',
    });
  }

  // Insurance
  const insurancePlan = resolveInsurancePlan(rule, req.insurancePlanCode);
  const insuranceDailyRate = insurancePlan ? insurancePlan.dailyRate : 0;
  const insuranceCharge = parseFloat((insuranceDailyRate * days).toFixed(2));
  if (insuranceCharge > 0) {
    breakdown.push({
      label: `Insurance — ${insurancePlan!.code}`,
      qty: days,
      unitLabel: 'day',
      unitPrice: insuranceDailyRate,
      amount: insuranceCharge,
      type: 'INSURANCE',
    });
  }

  // Extra options / ancillaries
  let extraCharges = 0;
  for (const ex of req.extraOptions ?? []) {
    const amt = Number(ex.amount ?? 0);
    extraCharges += amt;
    breakdown.push({
      label: ex.name,
      qty: 1,
      unitLabel: 'flat',
      unitPrice: amt,
      amount: amt,
      type: 'EXTRA',
    });
  }

  const subtotalBeforeDiscount = baseRentalCharge + insuranceCharge + extraCharges;

  // Promo discount
  let discountPct = 0;
  let discountAmount = 0;
  if (req.promoCode && rule?.promo_code === req.promoCode && rule.promo_discount_pct > 0) {
    const promoFrom = rule.promo_valid_from ? new Date(rule.promo_valid_from) : null;
    const promoTo = rule.promo_valid_to ? new Date(rule.promo_valid_to) : null;
    const now = req.pickupDate;
    const promoValid = (!promoFrom || now >= promoFrom) && (!promoTo || now <= promoTo);
    const usesOk = !rule.promo_max_uses || rule.promo_used_count < rule.promo_max_uses;
    if (promoValid && usesOk) {
      discountPct = rule.promo_discount_pct;
      discountAmount = parseFloat(((subtotalBeforeDiscount * discountPct) / 100).toFixed(2));
      breakdown.push({
        label: `Promo discount (${rule.promo_code}) -${discountPct}%`,
        qty: 1,
        unitLabel: 'flat',
        unitPrice: -discountAmount,
        amount: -discountAmount,
        type: 'DISCOUNT',
      });
    }
  }

  const subtotal = parseFloat((subtotalBeforeDiscount - discountAmount).toFixed(2));
  const taxAmount = parseFloat(((subtotal * TAX_RATE) / 100).toFixed(2));
  const totalAmount = parseFloat((subtotal + taxAmount).toFixed(2));

  breakdown.push({
    label: `VAT (${TAX_RATE}%)`,
    qty: 1,
    unitLabel: 'flat',
    unitPrice: taxAmount,
    amount: taxAmount,
    type: 'TAX',
  });

  return {
    appliedRuleId: rule?.id ?? null,
    ruleName: rule?.name ?? 'Default',
    appliedEventCode: appliedEvent?.eventCode ?? null,
    appliedEventName: appliedEvent?.name ?? null,
    vehicleCategory: req.vehicleCategory,
    totalDays: days,
    totalHours: hours,
    currency,
    dailyRate,
    baseRentalCharge,
    insurancePlanCode: insurancePlan?.code ?? null,
    insuranceDailyRate,
    insuranceCharge,
    extraCharges,
    subtotal,
    promoCode: req.promoCode ?? null,
    discountPct,
    discountAmount,
    taxablAmount: subtotal,
    taxRate: TAX_RATE,
    taxAmount,
    totalAmount,
    breakdown,
    yieldTrace,
    gracePeriodMin: rule?.grace_period_min ?? 30,
    lateFeePerHour: rule?.late_fee_per_hour ?? 0,
    lateFeeCap: rule?.late_fee_cap ?? 0,
    includedKmPerDay: rule?.included_km_per_day ?? 250,
    excessKmRate: rule?.excess_km_rate ?? 0,
    appliedAt: new Date().toISOString(),
  };
}

/**
 * Loads active `pricing_rules` + active `rate_events` inside a tenant-scoped
 * RLS transaction and computes the unified quote from the single master price list.
 */
export async function quoteRentalRateInTx(
  tx: TxClient,
  tenantId: string,
  req: Omit<RateRequest, 'events'>,
): Promise<RateResult> {
  const hasRawQuery = typeof tx?.$queryRawUnsafe === 'function';

  const rules = hasRawQuery
    ? await withSavepoint<PricingRuleRow[]>(
        tx,
        'quote_pricing_rules',
        () =>
          tx.$queryRawUnsafe<PricingRuleRow[]>(
            `SELECT * FROM pricing_rules
              WHERE tenant_id::text = $1 AND is_active = true
              ORDER BY priority DESC`,
            tenantId,
          ),
        [],
      )
    : [];

  const eventRows = hasRawQuery
    ? await withSavepoint<Record<string, unknown>[]>(
        tx,
        'quote_rate_events',
        () =>
          tx.$queryRawUnsafe<Record<string, unknown>[]>(
            `SELECT *
               FROM rate_events
              WHERE tenant_id::text = $1
                AND deleted_at IS NULL
                AND is_active = true
                AND date_from <= $2::timestamptz
                AND date_to >= $3::timestamptz`,
            tenantId,
            req.dropoffDate.toISOString(),
            req.pickupDate.toISOString(),
          ),
        [],
      )
    : [];

  const events: RateEventSnapshot[] = eventRows.map((e) => ({
    id: String(e.id ?? ''),
    eventCode: String(e.event_code ?? e.eventCode ?? e.name ?? ''),
    name: String(e.name ?? ''),
    dateFrom: new Date(String(e.date_from ?? e.dateFrom ?? req.pickupDate.toISOString())),
    dateTo: new Date(String(e.date_to ?? e.dateTo ?? req.dropoffDate.toISOString())),
    multiplier: Number(e.multiplier ?? 1),
    flatSurcharge:
      e.flat_surcharge != null
        ? Number(e.flat_surcharge)
        : e.flatSurcharge != null
          ? Number(e.flatSurcharge)
          : 0,
    applicableCategories: (e.applicable_categories ?? e.applicableCategories ?? null) as
      | string
      | null,
    applicableChannels: (e.applicable_channels ?? e.applicableChannels ?? null) as string | null,
    priority: Number(e.priority ?? 0),
    isActive: (e.is_active ?? e.isActive ?? true) !== false,
  }));

  let fleetUtilizationPct = req.fleetUtilizationPct;
  let totalCategoryFleet = req.totalCategoryFleet;

  if (hasRawQuery && req.enableUtilizationSurge !== false && fleetUtilizationPct == null) {
    const vehicleRows = await withSavepoint<Array<{ cat: string }>>(
      tx,
      'quote_util_fleet',
      () =>
        tx.$queryRawUnsafe<Array<{ cat: string }>>(
          `SELECT COALESCE(to_jsonb(v)->>'category', to_jsonb(v)->>'type', '') AS cat
             FROM vehicles v
            WHERE v.tenant_id::text = $1
              AND (to_jsonb(v)->>'deleted_at') IS NULL
              AND UPPER(COALESCE(v.status::text, '')) <> 'INACTIVE'`,
          tenantId,
        ),
      [],
    );

    const catFleet = vehicleRows.filter((v) =>
      categoriesMatch(v.cat ?? '', req.vehicleCategory),
    ).length;
    totalCategoryFleet = catFleet;

    if (catFleet >= 5) {
      const bookingRows = await withSavepoint<Array<{ vehicle_category: string | null }>>(
        tx,
        'quote_util_bookings',
        () =>
          tx.$queryRawUnsafe<Array<{ vehicle_category: string | null }>>(
            `SELECT vehicle_category
               FROM rental_bookings
              WHERE tenant_id::text = $1
                AND deleted_at IS NULL
                AND status IN ('CONFIRMED', 'ACTIVE')
                AND pickup_date <= $2::timestamptz
                AND dropoff_date >= $3::timestamptz`,
            tenantId,
            req.dropoffDate.toISOString(),
            req.pickupDate.toISOString(),
          ),
        [],
      );
      const overlappingBookings = bookingRows.filter((b) =>
        categoriesMatch(b.vehicle_category ?? '', req.vehicleCategory),
      ).length;
      fleetUtilizationPct = Math.min(100, Math.round((overlappingBookings / catFleet) * 100));
    }
  }

  return calculateRate(rules, {
    ...req,
    events,
    fleetUtilizationPct,
    totalCategoryFleet,
  });
}
