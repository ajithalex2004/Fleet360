/**
 * tests/unit/cba-engine.test.ts
 *
 * Unit tests for the CBA engine (lib/cba/engine.ts).
 */

import { describe, expect, it } from 'vitest';
import { cbaToWorkRules, cbaAudit, ruleDisplayValue, freshCbaRules } from '@/lib/cba/engine';
import { DEFAULT_CBA_RULES, type CbaRules } from '@/lib/cba/types';
import { DEFAULT_WORK_RULES } from '@/lib/plan/runcut';

describe('cba engine — cbaToWorkRules', () => {
  it('returns the defaults for an empty rule set', () => {
    const empty: CbaRules = { schemaVersion: 1, rules: [] };
    const wr = cbaToWorkRules(empty);
    expect(wr).toEqual(DEFAULT_WORK_RULES);
  });

  it('uses enforced rule values', () => {
    const rules: CbaRules = {
      schemaVersion: 1,
      rules: [
        { id: 'r1', name: 'Max', category: 'MAX_WORK_HOURS_PER_DAY', value: 10, unit: 'HOURS', enforced: true },
        { id: 'r2', name: 'OT', category: 'OT_RATE', value: 2, unit: 'MULTIPLIER', enforced: true },
      ],
    };
    const wr = cbaToWorkRules(rules);
    expect(wr.maxWorkHoursPerDay).toBe(10);
    expect(wr.overtimeRate).toBe(2);
  });

  it('ignores unenforced rules (falls back to defaults)', () => {
    const rules: CbaRules = {
      schemaVersion: 1,
      rules: [
        { id: 'r1', name: 'Max', category: 'MAX_WORK_HOURS_PER_DAY', value: 6, unit: 'HOURS', enforced: false },
      ],
    };
    const wr = cbaToWorkRules(rules);
    expect(wr.maxWorkHoursPerDay).toBe(DEFAULT_WORK_RULES.maxWorkHoursPerDay);
  });

  it('handles invalid (non-numeric) values by falling back to defaults', () => {
    const rules = JSON.parse(JSON.stringify(DEFAULT_CBA_RULES)) as CbaRules;
    // Corrupt the first rule
    rules.rules[0].value = Number.NaN;
    const wr = cbaToWorkRules(rules);
    expect(typeof wr.maxWorkHoursPerDay).toBe('number');
    expect(Number.isFinite(wr.maxWorkHoursPerDay)).toBe(true);
  });
});

describe('cba engine — cbaAudit', () => {
  it('returns ok for context within caps', () => {
    const findings = cbaAudit(DEFAULT_CBA_RULES, {
      workHoursPerDay: 7,
      spreadHoursPerDay: 10,
      minBreakBetweenTripsMins: 45,
    });
    const byCat = Object.fromEntries(findings.map((f) => [f.category, f.status]));
    expect(byCat.MAX_WORK_HOURS_PER_DAY).toBe('ok');
    expect(byCat.MAX_SPREAD_HOURS_PER_DAY).toBe('ok');
    expect(byCat.MIN_BREAK_BETWEEN_TRIPS).toBe('ok');
  });

  it('flags violations when work hours exceed the cap', () => {
    const findings = cbaAudit(DEFAULT_CBA_RULES, {
      workHoursPerDay: 9, // > 8 (default cap)
    });
    const f = findings.find((x) => x.category === 'MAX_WORK_HOURS_PER_DAY');
    expect(f).toBeDefined();
    expect(f!.status).toBe('violation');
    expect(f!.message).toContain('exceeds');
  });

  it('flags warn when work hours are within 10 % of the cap', () => {
    const findings = cbaAudit(DEFAULT_CBA_RULES, {
      workHoursPerDay: 7.5, // 8 * 0.9 = 7.2, so 7.5 > 7.2 → warn
    });
    const f = findings.find((x) => x.category === 'MAX_WORK_HOURS_PER_DAY');
    expect(f!.status).toBe('warn');
  });

  it('flags weekly OT violations', () => {
    // DEFAULT_CBA_RULES does not define MAX_OT_HOURS_PER_WEEK — supply a
    // custom rule set with the cap defined.
    const rules: CbaRules = {
      schemaVersion: 1,
      rules: [
        { id: 'r1', name: 'Weekly OT cap', category: 'MAX_OT_HOURS_PER_WEEK', value: 12, unit: 'HOURS', enforced: true },
      ],
    };
    const findings = cbaAudit(rules, {
      weeklyOvertimeHours: 15, // > 12
    });
    const f = findings.find((x) => x.category === 'MAX_OT_HOURS_PER_WEEK');
    expect(f).toBeDefined();
    expect(f!.status).toBe('violation');
  });

  it('flags min-break violations (plan break is below floor)', () => {
    const findings = cbaAudit(DEFAULT_CBA_RULES, {
      minBreakBetweenTripsMins: 10, // < 30 (default floor)
    });
    const f = findings.find((x) => x.category === 'MIN_BREAK_BETWEEN_TRIPS');
    expect(f!.status).toBe('violation');
  });

  it('returns empty array when context has no recognised fields', () => {
    const findings = cbaAudit(DEFAULT_CBA_RULES, {});
    expect(findings).toEqual([]);
  });

  it('skips rules that are not defined in the rule set', () => {
    // Rule set without MAX_WORK_HOURS_PER_DAY
    const rules: CbaRules = { schemaVersion: 1, rules: [] };
    const findings = cbaAudit(rules, { workHoursPerDay: 9 });
    const f = findings.find((x) => x.category === 'MAX_WORK_HOURS_PER_DAY');
    expect(f).toBeUndefined();
  });
});

describe('cba engine — ruleDisplayValue', () => {
  it('formats hours as "8 h"', () => {
    expect(ruleDisplayValue({ id: 'r', name: 'x', category: 'MAX_WORK_HOURS_PER_DAY', value: 8, unit: 'HOURS', enforced: true })).toBe('8 h');
  });
  it('formats minutes as "30 min"', () => {
    expect(ruleDisplayValue({ id: 'r', name: 'x', category: 'MIN_BREAK_BETWEEN_TRIPS', value: 30, unit: 'MINUTES', enforced: true })).toBe('30 min');
  });
  it('formats multipliers as "× 1.5"', () => {
    expect(ruleDisplayValue({ id: 'r', name: 'x', category: 'OT_RATE', value: 1.5, unit: 'MULTIPLIER', enforced: true })).toBe('× 1.5');
  });
  it('formats AED as "AED 25"', () => {
    expect(ruleDisplayValue({ id: 'r', name: 'x', category: 'HOURLY_RATE', value: 25, unit: 'AED', enforced: true })).toBe('AED 25');
  });
  it('uses stringValue when set', () => {
    expect(ruleDisplayValue({ id: 'r', name: 'x', category: 'WEEKLY_PATTERN', value: 0, unit: 'COUNT', enforced: true, stringValue: '5/2' })).toBe('5/2');
  });
});
