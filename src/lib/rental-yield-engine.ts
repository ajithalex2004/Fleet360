/**
 * RAC Yield-Management Engine
 *
 * Applies dynamic yield layers (Length-of-Rental, UAE Fri/Sat Weekend proportion,
 * Lead-Time, Fleet Utilization surge/discount, Event Calendar multipliers, and
 * Channel adjustments) with a full step-by-step audit trace.
 */

export interface YieldRequest {
  vehicleCategory: string;
  pickupDate: Date;
  dropoffDate: Date;
  channel?: 'DIRECT' | 'CORPORATE' | 'AGENCY' | 'ONLINE' | string;
  /** Today's date for lead-time calc. Pass req-time for testability. */
  asOf?: Date;
  /** Current fleet utilization for this category, 0-100. Optional. */
  fleetUtilizationPct?: number;
}

export interface RateEventSnapshot {
  id: string;
  eventCode: string;
  name: string;
  dateFrom: Date;
  dateTo: Date;
  multiplier: number;
  flatSurcharge?: number | null;
  applicableCategories: string | null;
  applicableChannels: string | null;
  priority: number;
  isActive: boolean;
}

export interface YieldRule {
  id: string;
  name?: string | null;
  vehicleCategory: string;
  baseDailyRate: number;
  weeklyRate?: number | null;
  monthlyRate?: number | null;
  weekendDailyRate?: number | null;
  priority?: number | null;
  isActive?: boolean | null;
}

export type LayerType =
  | 'BASE'
  | 'LOR'
  | 'WEEKEND'
  | 'LEAD_TIME'
  | 'UTILIZATION'
  | 'EVENT'
  | 'CHANNEL';

export interface YieldLayer {
  layer: LayerType;
  label: string;
  multiplier: number;       // 1.0 = no change, 1.20 = +20%, 0.85 = -15%
  dailyRateBefore: number;
  dailyRateAfter: number;
  rationale: string;
  metadata?: Record<string, unknown>;
}

export interface YieldResult {
  vehicleCategory: string;
  channel: string;
  totalDays: number;
  appliedRuleId: string | null;
  ruleName: string;
  baseDailyRate: number;
  finalDailyRate: number;
  baseRentalCharge: number;
  trace: YieldLayer[];
  /** Sum of all layer multipliers as percentages (informational). */
  totalAdjustmentPct: number;
  asOf: string;
}

/* ── Category Normalization (shared across RAC UI & Engines) ─────────────── */

const CATEGORY_SYNONYMS: Record<string, string> = {
  ECONOMY: 'ECONOMY',
  COMPACT: 'COMPACT',
  SEDAN: 'MID_SIZE',
  MID_SIZE: 'MID_SIZE',
  MID_SIZE_SEDAN: 'MID_SIZE',
  MIDSIZE: 'MID_SIZE',
  STANDARD: 'FULL_SIZE',
  FULL_SIZE: 'FULL_SIZE',
  FULL_SIZE_SEDAN: 'FULL_SIZE',
  FULLSIZE: 'FULL_SIZE',
  COMPACT_SUV: 'COMPACT_SUV',
  SUV: 'MID_SIZE_SUV',
  SUV_4X4: 'MID_SIZE_SUV',
  STANDARD_SUV: 'MID_SIZE_SUV',
  MID_SIZE_SUV: 'MID_SIZE_SUV',
  FULL_SIZE_SUV: 'FULL_SIZE_SUV',
  LARGE_SUV: 'FULL_SIZE_SUV',
  LUXURY: 'LUXURY',
  LUXURY_SEDAN: 'LUXURY',
  LUXURY_SUV: 'LUXURY',
  EXECUTIVE: 'LUXURY',
  PREMIUM: 'PREMIUM',
  SPORTS: 'SPORTS',
  VAN: 'VAN',
  MINIVAN: 'VAN',
  PICKUP: 'PICKUP',
  COMMERCIAL: 'PICKUP',
  TRUCK: 'PICKUP',
  BUS: 'BUS',
  MINI_BUS: 'BUS',
  MINIBUS: 'BUS',
  SPECIAL: 'SPECIAL',
};

export function normalizeRentalCategory(raw: string | null | undefined): string {
  const cleaned = String(raw ?? '')
    .trim()
    .toUpperCase()
    .replace(/[\s-]+/g, '_');
  return CATEGORY_SYNONYMS[cleaned] ?? cleaned;
}

export function categoriesMatch(a: string | null | undefined, b: string | null | undefined): boolean {
  if (!a || !b) return false;
  const rawA = a.trim().toUpperCase();
  const rawB = b.trim().toUpperCase();
  if (rawA === rawB) return true;
  return normalizeRentalCategory(rawA) === normalizeRentalCategory(rawB);
}

/* ── Defaults (overridable) ─────────────────────────────────────────────── */

export interface YieldPolicy {
  lorDiscountSteps: { minDays: number; discountPct: number; label: string }[];
  weekendUpliftPct: number;
  earlyBirdDays: number;
  earlyBirdDiscountPct: number;
  lastMinuteHours: number;
  lastMinuteUpliftPct: number;
  utilizationHighThresholdPct: number;
  utilizationHighSurgeMaxPct: number;
  utilizationLowThresholdPct: number;
  utilizationLowDiscountMaxPct: number;
  channelMultipliers: Record<string, number>;
}

export const DEFAULT_YIELD_POLICY: YieldPolicy = {
  lorDiscountSteps: [
    { minDays: 1, discountPct: 0, label: '1–3 days (full rate)' },
    { minDays: 4, discountPct: 10, label: '4–7 days (-10%)' },
    { minDays: 8, discountPct: 15, label: '8–14 days (-15%)' },
    { minDays: 15, discountPct: 20, label: '15–29 days (-20%)' },
    { minDays: 30, discountPct: 30, label: '30+ days (-30%)' },
  ],
  weekendUpliftPct: 10,
  earlyBirdDays: 30,
  earlyBirdDiscountPct: 8,
  lastMinuteHours: 48,
  lastMinuteUpliftPct: 15,
  utilizationHighThresholdPct: 80,
  utilizationHighSurgeMaxPct: 25,
  utilizationLowThresholdPct: 40,
  utilizationLowDiscountMaxPct: 12,
  channelMultipliers: {
    DIRECT: 1.0,
    CORPORATE: 0.92,
    AGENCY: 0.85,
    ONLINE: 0.95,
  },
};

/* ── Helpers ─────────────────────────────────────────────────────────────── */

function daysBetween(a: Date, b: Date): number {
  const ms = b.getTime() - a.getTime();
  return Math.max(1, Math.ceil(ms / 86400000));
}

const UAE_TZ_OFFSET_MS = 4 * 3_600_000; // Asia/Dubai (UTC+4, no DST)

export function countWeekendDays(from: Date, totalDays: number): number {
  let count = 0;
  const startMs = from.getTime();
  for (let i = 0; i < totalDays; i++) {
    const uaeDay = new Date(startMs + UAE_TZ_OFFSET_MS + i * 86_400_000).getUTCDay();
    if (uaeDay === 5 || uaeDay === 6) count++; // 5 = Fri, 6 = Sat (UAE weekend)
  }
  return count;
}

function findLorStep(days: number, policy: YieldPolicy) {
  let chosen = policy.lorDiscountSteps[0];
  for (const step of policy.lorDiscountSteps) {
    if (days >= step.minDays) chosen = step;
  }
  return chosen;
}

export function pickApplicableRateEvent(
  events: RateEventSnapshot[],
  req: { vehicleCategory: string; pickupDate: Date; dropoffDate?: Date; channel?: string },
): RateEventSnapshot | null {
  const dropoff = req.dropoffDate ?? req.pickupDate;
  const candidates = events.filter((e) => {
    if (e.isActive === false) return false;
    // Match any event overlapping [pickupDate, dropoffDate]
    if (dropoff < e.dateFrom || req.pickupDate > e.dateTo) return false;
    if (e.applicableCategories) {
      const cats = e.applicableCategories.split(',').map((s) => s.trim());
      if (!cats.includes('ALL') && !cats.some((c) => categoriesMatch(c, req.vehicleCategory))) {
        return false;
      }
    }
    if (e.applicableChannels && req.channel) {
      const chans = e.applicableChannels.split(',').map((s) => s.trim().toUpperCase());
      if (!chans.includes('ALL') && !chans.includes(req.channel.toUpperCase())) return false;
    }
    return true;
  });
  if (candidates.length === 0) return null;
  candidates.sort((a, b) => {
    const pri = (b.priority ?? 0) - (a.priority ?? 0);
    if (pri !== 0) return pri;
    return Math.abs(b.multiplier - 1) - Math.abs(a.multiplier - 1);
  });
  return candidates[0];
}

function pickBaseRule(rules: YieldRule[], category: string): YieldRule | null {
  const active = rules
    .filter((r) => r.isActive !== false && categoriesMatch(r.vehicleCategory, category))
    .sort((a, b) => {
      const exactA = a.vehicleCategory.trim().toUpperCase() === category.trim().toUpperCase() ? 1 : 0;
      const exactB = b.vehicleCategory.trim().toUpperCase() === category.trim().toUpperCase() ? 1 : 0;
      if (exactB !== exactA) return exactB - exactA;
      return (b.priority ?? 0) - (a.priority ?? 0);
    });
  return active[0] ?? null;
}

/* ── Engine ──────────────────────────────────────────────────────────────── */

export interface YieldEngineInput {
  request: YieldRequest;
  rules: YieldRule[];
  events: RateEventSnapshot[];
  policy?: Partial<YieldPolicy>;
}

export function calculateYieldRate(input: YieldEngineInput): YieldResult {
  const { request: req } = input;
  const policy: YieldPolicy = { ...DEFAULT_YIELD_POLICY, ...(input.policy ?? {}) };
  const asOf = req.asOf ?? new Date();
  const trace: YieldLayer[] = [];

  // Layer 1 — BASE
  const rule = pickBaseRule(input.rules, req.vehicleCategory);
  const baseDailyRate = rule?.baseDailyRate ?? 0;
  let dailyRate = baseDailyRate;
  trace.push({
    layer: 'BASE',
    label: rule ? `Base rate · ${rule.name ?? rule.vehicleCategory}` : 'No matching rule (rate = 0)',
    multiplier: 1,
    dailyRateBefore: baseDailyRate,
    dailyRateAfter: baseDailyRate,
    rationale: rule
      ? `Base daily rate for ${req.vehicleCategory} from rule "${rule.name ?? rule.id}".`
      : `No active PricingRule for ${req.vehicleCategory}. Configure one in /rental/rates.`,
    metadata: { ruleId: rule?.id ?? null },
  });

  const totalDays = daysBetween(req.pickupDate, req.dropoffDate);

  // Layer 2 — LOR (honors explicit monthly/weekly rule rates when configured, else policy step discounts)
  if (rule && totalDays >= 28 && rule.monthlyRate && rule.monthlyRate > 0 && baseDailyRate > 0) {
    const tierAfter = round2(rule.monthlyRate / 30);
    const tierMult = Number((tierAfter / dailyRate).toFixed(4));
    trace.push({
      layer: 'LOR',
      label: `Monthly tariff tier (${totalDays}d)`,
      multiplier: tierMult,
      dailyRateBefore: dailyRate,
      dailyRateAfter: tierAfter,
      rationale: `Applied rule monthly tariff (${rule.monthlyRate}/30d) for ${totalDays}-day rental.`,
      metadata: { totalDays, monthlyRate: rule.monthlyRate },
    });
    dailyRate = tierAfter;
  } else if (rule && totalDays >= 7 && rule.weeklyRate && rule.weeklyRate > 0 && baseDailyRate > 0) {
    const tierAfter = round2(rule.weeklyRate / 7);
    const tierMult = Number((tierAfter / dailyRate).toFixed(4));
    trace.push({
      layer: 'LOR',
      label: `Weekly tariff tier (${totalDays}d)`,
      multiplier: tierMult,
      dailyRateBefore: dailyRate,
      dailyRateAfter: tierAfter,
      rationale: `Applied rule weekly tariff (${rule.weeklyRate}/7d) for ${totalDays}-day rental.`,
      metadata: { totalDays, weeklyRate: rule.weeklyRate },
    });
    dailyRate = tierAfter;
  } else {
    const lorStep = findLorStep(totalDays, policy);
    const lorMultiplier = 1 - lorStep.discountPct / 100;
    const lorAfter = round2(dailyRate * lorMultiplier);
    if (lorStep.discountPct !== 0) {
      trace.push({
        layer: 'LOR',
        label: `Length-of-rental · ${lorStep.label}`,
        multiplier: lorMultiplier,
        dailyRateBefore: dailyRate,
        dailyRateAfter: lorAfter,
        rationale: `Rental duration is ${totalDays} day${totalDays === 1 ? '' : 's'}, qualifying for ${lorStep.label}.`,
        metadata: { lorStep, totalDays },
      });
    }
    dailyRate = lorAfter;
  }

  // Layer 3 — WEEKEND (strictly proportional to actual Fri/Sat days in [pickupDate, dropoffDate))
  const weekendDays = countWeekendDays(req.pickupDate, totalDays);
  const ruleWeekendUpliftPct =
    rule?.weekendDailyRate != null &&
    baseDailyRate > 0 &&
    rule.weekendDailyRate > baseDailyRate
      ? ((rule.weekendDailyRate - baseDailyRate) / baseDailyRate) * 100
      : policy.weekendUpliftPct;

  if (ruleWeekendUpliftPct > 0 && weekendDays > 0) {
    const effectiveUpliftPct = (ruleWeekendUpliftPct * weekendDays) / totalDays;
    const m = 1 + effectiveUpliftPct / 100;
    const after = round2(dailyRate * m);
    trace.push({
      layer: 'WEEKEND',
      label: `Weekend uplift +${effectiveUpliftPct.toFixed(1)}% (${weekendDays}/${totalDays}d)`,
      multiplier: m,
      dailyRateBefore: dailyRate,
      dailyRateAfter: after,
      rationale: `${weekendDays} of ${totalDays} rental day(s) fall on Fri/Sat (+${ruleWeekendUpliftPct.toFixed(1)}% on weekend days).`,
      metadata: { weekendDays, totalDays, effectiveUpliftPct: round2(effectiveUpliftPct) },
    });
    dailyRate = after;
  }

  // Layer 4 — LEAD_TIME
  const hoursLead = (req.pickupDate.getTime() - asOf.getTime()) / 3_600_000;
  if (hoursLead >= 0 && hoursLead <= policy.lastMinuteHours && policy.lastMinuteUpliftPct > 0) {
    const m = 1 + policy.lastMinuteUpliftPct / 100;
    const after = round2(dailyRate * m);
    trace.push({
      layer: 'LEAD_TIME',
      label: `Last-minute booking +${policy.lastMinuteUpliftPct}%`,
      multiplier: m,
      dailyRateBefore: dailyRate,
      dailyRateAfter: after,
      rationale: `Booking made within ${policy.lastMinuteHours}h of pickup (${hoursLead.toFixed(1)}h ahead).`,
      metadata: { hoursLead: round2(hoursLead) },
    });
    dailyRate = after;
  } else if (hoursLead >= policy.earlyBirdDays * 24 && policy.earlyBirdDiscountPct > 0) {
    const m = 1 - policy.earlyBirdDiscountPct / 100;
    const after = round2(dailyRate * m);
    trace.push({
      layer: 'LEAD_TIME',
      label: `Early-bird booking -${policy.earlyBirdDiscountPct}%`,
      multiplier: m,
      dailyRateBefore: dailyRate,
      dailyRateAfter: after,
      rationale: `Booking made ${(hoursLead / 24).toFixed(0)} days ahead of pickup (≥ ${policy.earlyBirdDays} day threshold).`,
      metadata: { daysLead: round2(hoursLead / 24) },
    });
    dailyRate = after;
  }

  // Layer 5 — UTILIZATION
  if (req.fleetUtilizationPct != null) {
    const u = Math.min(100, Math.max(0, req.fleetUtilizationPct));
    if (u >= policy.utilizationHighThresholdPct) {
      const span = 100 - policy.utilizationHighThresholdPct;
      const surgePct = span > 0
        ? ((u - policy.utilizationHighThresholdPct) / span) * policy.utilizationHighSurgeMaxPct
        : 0;
      if (surgePct > 0) {
        const m = 1 + surgePct / 100;
        const after = round2(dailyRate * m);
        trace.push({
          layer: 'UTILIZATION',
          label: `Utilization surge +${surgePct.toFixed(1)}%`,
          multiplier: m,
          dailyRateBefore: dailyRate,
          dailyRateAfter: after,
          rationale: `Fleet utilization for ${req.vehicleCategory} is ${u}%, above the ${policy.utilizationHighThresholdPct}% surge threshold.`,
          metadata: { utilizationPct: u, surgePct: round2(surgePct) },
        });
        dailyRate = after;
      }
    } else if (u <= policy.utilizationLowThresholdPct) {
      const span = policy.utilizationLowThresholdPct;
      const discountPct = span > 0
        ? ((policy.utilizationLowThresholdPct - u) / span) * policy.utilizationLowDiscountMaxPct
        : 0;
      if (discountPct > 0) {
        const m = 1 - discountPct / 100;
        const after = round2(dailyRate * m);
        trace.push({
          layer: 'UTILIZATION',
          label: `Low-utilization discount -${discountPct.toFixed(1)}%`,
          multiplier: m,
          dailyRateBefore: dailyRate,
          dailyRateAfter: after,
          rationale: `Fleet utilization for ${req.vehicleCategory} is ${u}%, below the ${policy.utilizationLowThresholdPct}% discount threshold.`,
          metadata: { utilizationPct: u, discountPct: round2(discountPct) },
        });
        dailyRate = after;
      }
    }
  }

  // Layer 6 — EVENT
  const event = pickApplicableRateEvent(input.events, req);
  if (event && event.multiplier !== 1) {
    const after = round2(dailyRate * event.multiplier);
    const sign = event.multiplier > 1 ? '+' : '';
    const pct = ((event.multiplier - 1) * 100).toFixed(1);
    trace.push({
      layer: 'EVENT',
      label: `${event.name} · ${sign}${pct}%`,
      multiplier: event.multiplier,
      dailyRateBefore: dailyRate,
      dailyRateAfter: after,
      rationale: `Rental period overlaps event "${event.eventCode}" (${event.name}).`,
      metadata: { eventId: event.id, eventCode: event.eventCode, dateFrom: event.dateFrom, dateTo: event.dateTo },
    });
    dailyRate = after;
  }

  // Layer 7 — CHANNEL
  const channel = req.channel ?? 'DIRECT';
  const channelMult = policy.channelMultipliers[channel] ?? 1;
  if (channelMult !== 1) {
    const after = round2(dailyRate * channelMult);
    const pct = ((channelMult - 1) * 100).toFixed(1);
    const sign = channelMult > 1 ? '+' : '';
    trace.push({
      layer: 'CHANNEL',
      label: `Channel adjustment · ${channel} (${sign}${pct}%)`,
      multiplier: channelMult,
      dailyRateBefore: dailyRate,
      dailyRateAfter: after,
      rationale: `Per-channel pricing rule for ${channel}.`,
      metadata: { channel, multiplier: channelMult },
    });
    dailyRate = after;
  }

  const finalDailyRate = round2(dailyRate);
  const eventFlatSurcharge = round2(Math.max(0, Number(event?.flatSurcharge ?? 0)));
  const baseRentalCharge = round2(finalDailyRate * totalDays + eventFlatSurcharge);
  const totalAdjustmentPct = baseDailyRate > 0
    ? round2(((finalDailyRate - baseDailyRate) / baseDailyRate) * 100)
    : 0;

  return {
    vehicleCategory: req.vehicleCategory,
    channel,
    totalDays,
    appliedRuleId: rule?.id ?? null,
    ruleName: rule?.name ?? 'Default',
    baseDailyRate,
    finalDailyRate,
    baseRentalCharge,
    trace,
    totalAdjustmentPct,
    asOf: asOf.toISOString(),
  };
}

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}
