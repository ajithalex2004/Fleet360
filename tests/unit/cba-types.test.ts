/**
 * tests/unit/cba-types.test.ts
 *
 * Unit tests for CBA rule-set types + helpers (lib/cba/types.ts).
 */

import { describe, expect, it } from 'vitest';
import {
  getRuleValue,
  findRule,
  freshCbaRules,
  DEFAULT_CBA_RULES,
  CBA_SCHEMA_VERSION,
  type CbaRules,
} from '@/lib/cba/types';

describe('cba types — schema version', () => {
  it('exports a positive integer schema version', () => {
    expect(typeof CBA_SCHEMA_VERSION).toBe('number');
    expect(CBA_SCHEMA_VERSION).toBeGreaterThan(0);
  });

  it('default rules carry the current schema version', () => {
    expect(DEFAULT_CBA_RULES.schemaVersion).toBe(CBA_SCHEMA_VERSION);
  });
});

describe('cba types — getRuleValue', () => {
  const rules = DEFAULT_CBA_RULES;

  it('returns the value of an existing rule', () => {
    expect(getRuleValue(rules, 'MAX_WORK_HOURS_PER_DAY')).toBe(8);
    expect(getRuleValue(rules, 'OT_RATE')).toBe(1.5);
    expect(getRuleValue(rules, 'HOURLY_RATE')).toBe(25);
  });

  it('returns undefined for a missing rule', () => {
    const empty: CbaRules = { schemaVersion: 1, rules: [] };
    expect(getRuleValue(empty, 'MAX_WORK_HOURS_PER_DAY')).toBeUndefined();
  });

  it('returns the first match when multiple rules share a category', () => {
    const dup: CbaRules = {
      schemaVersion: 1,
      rules: [
        { id: 'r1', name: 'first', category: 'MAX_WORK_HOURS_PER_DAY', value: 8, unit: 'HOURS', enforced: true },
        { id: 'r2', name: 'second', category: 'MAX_WORK_HOURS_PER_DAY', value: 6, unit: 'HOURS', enforced: true },
      ],
    };
    expect(getRuleValue(dup, 'MAX_WORK_HOURS_PER_DAY')).toBe(8);
  });
});

describe('cba types — findRule', () => {
  it('returns the full rule record', () => {
    const r = findRule(DEFAULT_CBA_RULES, 'MAX_WORK_HOURS_PER_DAY');
    expect(r).toBeDefined();
    expect(r?.category).toBe('MAX_WORK_HOURS_PER_DAY');
    expect(r?.value).toBe(8);
    expect(r?.unit).toBe('HOURS');
    expect(r?.enforced).toBe(true);
  });

  it('returns undefined for missing rule', () => {
    const empty: CbaRules = { schemaVersion: 1, rules: [] };
    expect(findRule(empty, 'OT_RATE')).toBeUndefined();
  });
});

describe('cba types — freshCbaRules', () => {
  it('returns a deep copy of the defaults', () => {
    const f = freshCbaRules();
    expect(f.schemaVersion).toBe(CBA_SCHEMA_VERSION);
    expect(f.rules.length).toBeGreaterThan(0);
    // Each rule should have a unique id
    const ids = new Set(f.rules.map((r) => r.id));
    expect(ids.size).toBe(f.rules.length);
  });

  it('mutating the fresh copy does not affect the defaults', () => {
    const f = freshCbaRules();
    f.rules[0].value = 999;
    expect(DEFAULT_CBA_RULES.rules[0].value).not.toBe(999);
  });

  it('produces independent rule sets across calls', () => {
    const a = freshCbaRules();
    const b = freshCbaRules();
    a.rules[0].value = 100;
    expect(b.rules[0].value).not.toBe(100);
  });
});
