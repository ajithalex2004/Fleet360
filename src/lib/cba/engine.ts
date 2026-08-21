/**
 * lib/cba/engine.ts — Convert a CBA rule-set to a workRules object.
 *
 * The Planning Core (runcut / block / roster) works against a flat
 * `WorkRules` shape. The CBA engine reads a `CbaRules` payload and
 * produces the equivalent `WorkRules`. Per-rule `enforced: false` is
 * ignored — those rules are still reported in the compliance audit
 * but don't constrain the algorithm.
 *
 * Also: a `cbaAudit(rules, workRules)` helper that returns a list of
 * compliance notes for a planning result, so the UI can surface
 * "this run violates MAX_WORK_HOURS_PER_DAY" warnings.
 */

import type { CbaRules, CbaRule, CbaRuleCategory } from './types';
import { findRule, getRuleValue, DEFAULT_CBA_RULES } from './types';
import type { WorkRules } from '@/lib/plan/runcut';
import { DEFAULT_WORK_RULES } from '@/lib/plan/runcut';
import type { PrismaClient } from '@prisma/client';

function n(v: number | undefined, fallback: number): number {
  return typeof v === 'number' && Number.isFinite(v) ? v : fallback;
}

function s(v: string | undefined, fallback: string): string {
  return v && v.length > 0 ? v : fallback;
}

export function cbaToWorkRules(rules: CbaRules): WorkRules {
  // Only consider rules that are explicitly enforced
  const enforced = (cat: CbaRuleCategory) => {
    const r = findRule(rules, cat);
    return r?.enforced ? r.value : undefined;
  };

  return {
    maxWorkHoursPerDay:     n(enforced('MAX_WORK_HOURS_PER_DAY'),    DEFAULT_WORK_RULES.maxWorkHoursPerDay),
    maxSpreadHoursPerDay:   n(enforced('MAX_SPREAD_HOURS_PER_DAY'),  DEFAULT_WORK_RULES.maxSpreadHoursPerDay),
    minBreakBetweenTripsMins: n(enforced('MIN_BREAK_BETWEEN_TRIPS'), DEFAULT_WORK_RULES.minBreakBetweenTripsMins),
    overtimeThresholdHours: n(enforced('OT_THRESHOLD_HOURS'),        DEFAULT_WORK_RULES.overtimeThresholdHours),
    overtimeRate:           n(enforced('OT_RATE'),                    DEFAULT_WORK_RULES.overtimeRate),
    hourlyRate:             n(enforced('HOURLY_RATE'),                DEFAULT_WORK_RULES.hourlyRate),
    reportTimeMins:         n(enforced('REPORT_TIME_MIN'),           DEFAULT_WORK_RULES.reportTimeMins),
    wrapTimeMins:           n(enforced('WRAP_TIME_MIN'),             DEFAULT_WORK_RULES.wrapTimeMins),
    deadheadMinsBetweenTrips: n(enforced('MIN_DEADHEAD_BETWEEN_TRIPS'), DEFAULT_WORK_RULES.deadheadMinsBetweenTrips),
    maxTripsPerRun:         n(enforced('MAX_TRIPS_PER_RUN'),         DEFAULT_WORK_RULES.maxTripsPerRun),
  };
}

/**
 * Resolve the tenant's default CBA rule-set (if any) into WorkRules.
 * Returns null when the tenant has no default rule-set — callers should
 * fall back to DEFAULT_WORK_RULES in that case, same as when no CBA
 * exists at all. This is the one place that was previously missing: the
 * Planning Core's compute endpoint built WorkRules purely from the
 * request body / DEFAULT_WORK_RULES and never consulted CbaRuleSet,
 * despite cbaToWorkRules() existing specifically for this.
 */
export async function resolveCbaWorkRules(
  prisma: PrismaClient,
  tenantId: string,
): Promise<WorkRules | null> {
  const ruleSet = await prisma.cbaRuleSet.findFirst({
    where: { tenantId, isDefault: true, deletedAt: null },
    select: { rulesJson: true },
  });
  if (!ruleSet?.rulesJson) return null;
  return cbaToWorkRules(ruleSet.rulesJson as unknown as CbaRules);
}

/** Look up a rule's display value — number, or a stringValue if set. */
export function ruleDisplayValue(rule: CbaRule): string {
  if (rule.stringValue) return rule.stringValue;
  switch (rule.unit) {
    case 'AED':        return `AED ${rule.value}`;
    case 'HOURS':      return `${rule.value} h`;
    case 'MINUTES':    return `${rule.value} min`;
    case 'MULTIPLIER': return `× ${rule.value}`;
    case 'PERCENT':    return `${rule.value}%`;
    case 'COUNT':      return `${rule.value}`;
    default:           return `${rule.value}`;
  }
}

/** Audit a plan result against the CBA. Returns per-rule findings. */
export function cbaAudit(
  rules: CbaRules,
  context: {
    workHoursPerDay?: number;
    spreadHoursPerDay?: number;
    weeklyHours?: number;
    weeklyOvertimeHours?: number;
    minBreakBetweenTripsMins?: number;
    tripsPerRun?: number;
  },
): Array<{ category: CbaRuleCategory; name: string; status: 'ok' | 'warn' | 'violation'; message: string; value: number | string | undefined; threshold: number | string | undefined }> {
  const findings: Array<{ category: CbaRuleCategory; name: string; status: 'ok' | 'warn' | 'violation'; message: string; value: number | string | undefined; threshold: number | string | undefined }> = [];
  const en = (cat: CbaRuleCategory) => findRule(rules, cat);

  if (context.workHoursPerDay !== undefined) {
    const r = en('MAX_WORK_HOURS_PER_DAY');
    if (r) {
      const status = context.workHoursPerDay > r.value ? 'violation' : (context.workHoursPerDay > r.value * 0.9 ? 'warn' : 'ok');
      findings.push({
        category: 'MAX_WORK_HOURS_PER_DAY',
        name: r.name,
        status, value: context.workHoursPerDay, threshold: r.value,
        message: status === 'violation'
          ? `Work hours ${context.workHoursPerDay.toFixed(1)}h exceeds the CBA cap of ${r.value}h.`
          : status === 'warn'
          ? `Work hours ${context.workHoursPerDay.toFixed(1)}h are within 10 % of the cap of ${r.value}h.`
          : `Work hours ${context.workHoursPerDay.toFixed(1)}h within cap of ${r.value}h.`,
      });
    }
  }

  if (context.spreadHoursPerDay !== undefined) {
    const r = en('MAX_SPREAD_HOURS_PER_DAY');
    if (r) {
      const status = context.spreadHoursPerDay > r.value ? 'violation' : (context.spreadHoursPerDay > r.value * 0.9 ? 'warn' : 'ok');
      findings.push({
        category: 'MAX_SPREAD_HOURS_PER_DAY',
        name: r.name,
        status, value: context.spreadHoursPerDay, threshold: r.value,
        message: status === 'violation'
          ? `Spread ${context.spreadHoursPerDay.toFixed(1)}h exceeds the CBA cap of ${r.value}h.`
          : status === 'warn'
          ? `Spread ${context.spreadHoursPerDay.toFixed(1)}h is within 10 % of the cap of ${r.value}h.`
          : `Spread ${context.spreadHoursPerDay.toFixed(1)}h within cap of ${r.value}h.`,
      });
    }
  }

  if (context.minBreakBetweenTripsMins !== undefined) {
    const r = en('MIN_BREAK_BETWEEN_TRIPS');
    if (r) {
      const status = context.minBreakBetweenTripsMins < r.value ? 'violation' : 'ok';
      findings.push({
        category: 'MIN_BREAK_BETWEEN_TRIPS',
        name: r.name,
        status, value: context.minBreakBetweenTripsMins, threshold: r.value,
        message: status === 'violation'
          ? `Min break ${context.minBreakBetweenTripsMins} min is below the CBA floor of ${r.value} min.`
          : `Min break ${context.minBreakBetweenTripsMins} min meets the CBA floor of ${r.value} min.`,
      });
    }
  }

  if (context.weeklyHours !== undefined) {
    const r = en('MAX_WORK_HOURS_PER_WEEK');
    if (r) {
      const status = context.weeklyHours > r.value ? 'violation' : (context.weeklyHours > r.value * 0.9 ? 'warn' : 'ok');
      findings.push({
        category: 'MAX_WORK_HOURS_PER_WEEK',
        name: r.name,
        status, value: context.weeklyHours, threshold: r.value,
        message: status === 'violation'
          ? `Weekly hours ${context.weeklyHours.toFixed(1)}h exceeds the CBA cap of ${r.value}h.`
          : `Weekly hours ${context.weeklyHours.toFixed(1)}h within cap of ${r.value}h.`,
      });
    }
  }

  if (context.weeklyOvertimeHours !== undefined) {
    const r = en('MAX_OT_HOURS_PER_WEEK');
    if (r) {
      const status = context.weeklyOvertimeHours > r.value ? 'violation' : 'ok';
      findings.push({
        category: 'MAX_OT_HOURS_PER_WEEK',
        name: r.name,
        status, value: context.weeklyOvertimeHours, threshold: r.value,
        message: status === 'violation'
          ? `Weekly OT ${context.weeklyOvertimeHours.toFixed(1)}h exceeds the CBA cap of ${r.value}h.`
          : `Weekly OT ${context.weeklyOvertimeHours.toFixed(1)}h within cap of ${r.value}h.`,
      });
    }
  }

  if (context.tripsPerRun !== undefined) {
    const r = en('MAX_TRIPS_PER_RUN');
    if (r) {
      const status = context.tripsPerRun > r.value ? 'violation' : 'ok';
      findings.push({
        category: 'MAX_TRIPS_PER_RUN',
        name: r.name,
        status, value: context.tripsPerRun, threshold: r.value,
        message: status === 'violation'
          ? `Run has ${context.tripsPerRun} trips, exceeds the CBA cap of ${r.value}.`
          : `Run has ${context.tripsPerRun} trips, within the cap of ${r.value}.`,
      });
    }
  }

  return findings;
}

/** Convenience: get the engine-resolved defaults for a brand-new CBA. */
export function freshCbaRules(): CbaRules {
  return JSON.parse(JSON.stringify(DEFAULT_CBA_RULES)) as CbaRules;
}
