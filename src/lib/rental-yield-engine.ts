/**
 * RAC Yield-Management Engine
 *
 * Wraps the base rate engine (lib/rental-rate-engine.ts) and applies six
 * yield layers on top, each producing a documented adjustment so the user
 * can see exactly how the final price was reached.
 *
 * Layers, in order:
 *   1. BASE         — pickBestRate() from the existing rate engine
 *   2. LOR          — length-of-rental discount (granular ladder vs the
 *                     simpler weekly/monthly auto-pick in the base engine)
 *   3. WEEKEND      — weekday vs weekend uplift
 *   4. LEAD_TIME    — early-bird / last-minute multiplier
 *   5. UTILIZATION  — fleet-utilization-based surge or discount
 *   6. EVENT        — date-tagged event multipliers (DSF, Eid, F1, etc.)
 *   7. CHANNEL      — final per-channel adjustment (DIRECT/CORPORATE/AGENCY/ONLINE)
 *
 * Each layer logs to the trace[] so the UI / audit can show step-by-step.
 *
 * Pure functions — no DB calls. The caller fetches:
 *   - active PricingRule rows
 *   - active RateEvent rows for the period
 *   - current category-utilization snapshot
 * and passes everything in.
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
  weekendDailyRate?: number | null;
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

/* ── Defaults (overridable) ─────────────────────────────────────────────── */

export interface YieldPolicy {
  // LoR ladder thresholds and discounts (positive = discount)
  lorDiscountSteps: { minDays: number; discountPct: number; label: string }[];
  // Weekend uplift in %
  weekendUpliftPct: number;
  // Lead-time
  earlyBirdDays: number;       // book this many days ahead → discount
  earlyBirdDiscountPct: number;
  lastMinuteHours: number;     // book within this many hours of pickup → uplift
  lastMinuteUpliftPct: number;
  // Utilization surge
  utilizationHighThresholdPct: number;
  utilizationHighSurgeMaxPct: number;  // max surge at 100% utilization
  utilizationLowThresholdPct: number;
  utilizationLowDiscountMaxPct: number; // max discount at 0% utilization
  // Channel multipliers (1.0 = no change)
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
    CORPORATE: 0.92,   // negotiated -8%
    AGENCY: 0.85,      // -15% commission to OTAs absorbed
    ONLINE: 0.95,      // -5% to incentivise direct online bookings
  },
};

/* ── Helpers ─────────────────────────────────────────────────────────────── */

function daysBetween(a: Date, b: Date): number {
  const ms = b.getTime() - a.getTime();
  return Math.max(1, Math.ceil(ms / 86400000));
}

function spansWeekend(from: Date, to: Date): boolean {
  // True if any day of the rental is Friday or Saturday (UAE weekend).
  const start = new Date(from); start.setHours(0, 0, 0, 0);
  const end = new Date(to); end.setHours(0, 0, 0, 0);
  for (let d = new Date(start); d <= end; d.setDate(d.getDate() + 1)) {
    const dow = d.getDay(); // 0=Sun, 5=Fri, 6=Sat
    if (dow === 5 || dow === 6) return true;
  }
  return false;
}

function findLorStep(days: number, policy: YieldPolicy) {
  let chosen = policy.lorDiscountSteps[0];
  for (const step of policy.lorDiscountSteps) {
    if (days >= step.minDays) chosen = step;
  }
  return chosen;
}

function pickEvent(events: RateEventSnapshot[], req: YieldRequest): RateEventSnapshot | null {
  const candidates = events.filter((e) => {
    if (e.isActive === false) return false;
    if (req.pickupDate < e.dateFrom || req.pickupDate > e.dateTo) return false;
    if (e.applicableCategories) {
      const cats = e.applicableCategories.split(',').map((s) => s.trim());
      if (!cats.includes('ALL') && !cats.includes(req.vehicleCategory)) return false;
    }
    if (e.applicableChannels && req.channel) {
      const chans = e.applicableChannels.split(',').map((s) => s.trim());
      if (!chans.includes('ALL') && !chans.includes(req.channel)) return false;
    }
    return true;
  });
  if (candidates.length === 0) return null;
  // Highest priority wins; tie-broken by greatest absolute multiplier delta from 1.
  candidates.sort((a, b) => {
    const pri = (b.priority ?? 0) - (a.priority ?? 0);
    if (pri !== 0) return pri;
    return Math.abs(b.multiplier - 1) - Math.abs(a.multiplier - 1);
  });
  return candidates[0];
}

function pickBaseRule(rules: YieldRule[], category: string): YieldRule | null {
  return rules.find((r) => r.isActive !== false && r.vehicleCategory === category) ?? null;
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

  // Layer 2 — LOR
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

  // Layer 3 — WEEKEND
  if (policy.weekendUpliftPct > 0 && spansWeekend(req.pickupDate, req.dropoffDate)) {
    const m = 1 + policy.weekendUpliftPct / 100;
    const after = round2(dailyRate * m);
    trace.push({
      layer: 'WEEKEND',
      label: `Weekend uplift +${policy.weekendUpliftPct}%`,
      multiplier: m,
      dailyRateBefore: dailyRate,
      dailyRateAfter: after,
      rationale: 'Rental period includes a Friday or Saturday (UAE weekend).',
    });
    dailyRate = after;
  }

  // Layer 4 — LEAD_TIME
  const hoursLead = (req.pickupDate.getTime() - asOf.getTime()) / 3_600_000;
  if (hoursLead <= policy.lastMinuteHours && policy.lastMinuteUpliftPct > 0) {
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
      // Linearly interpolate surge: at threshold => 0%, at 100% => max
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
  const event = pickEvent(input.events, req);
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
      rationale: `Pickup date falls within event "${event.eventCode}" (${event.name}).`,
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
  const baseRentalCharge = round2(finalDailyRate * totalDays);
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
