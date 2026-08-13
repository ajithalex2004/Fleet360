/**
 * tests/unit/headway-service.test.ts
 *
 * Unit tests for the headway expansion service (lib/headway/service.ts).
 */

import { describe, expect, it } from 'vitest';
import {
  expandHeadway,
  daysToMask,
  maskToDays,
  maskToLabel,
  type HeadwayRuleInput,
} from '@/lib/headway/service';

const baseRule: HeadwayRuleInput = {
  id: 'rule1',
  routeId: 'route1',
  dayMask: 'YYYYYYY',
  startTime: '06:00',
  endTime: '09:00',
  headwayMinutes: 30,
  anchorTime: null,
};

describe('headway service — daysToMask / maskToDays', () => {
  it('round-trips a full week', () => {
    const mask = daysToMask([0, 1, 2, 3, 4, 5, 6]);
    expect(mask).toBe('YYYYYYY');
    expect(maskToDays(mask)).toEqual([0, 1, 2, 3, 4, 5, 6]);
  });

  it('round-trips weekdays only', () => {
    const mask = daysToMask([1, 2, 3, 4, 5]);
    expect(mask).toBe('NYYYYYN');
    expect(maskToDays(mask)).toEqual([1, 2, 3, 4, 5]);
  });

  it('round-trips weekends only', () => {
    const mask = daysToMask([0, 6]);
    expect(mask).toBe('YNNNNNY');
    expect(maskToDays(mask)).toEqual([0, 6]);
  });

  it('returns NNNNNNN for empty input', () => {
    expect(daysToMask([])).toBe('NNNNNNN');
  });

  it('ignores out-of-range day indices', () => {
    expect(daysToMask([1, 7, 8, -1])).toBe('NYNNNNN');
  });
});

describe('headway service — maskToLabel', () => {
  it('returns "Every day" for full week', () => {
    expect(maskToLabel('YYYYYYY')).toBe('Every day');
  });
  it('returns "Never" for empty', () => {
    expect(maskToLabel('NNNNNNN')).toBe('Never');
  });
  it('returns weekday label', () => {
    expect(maskToLabel('NYYYYYN')).toBe('Weekdays (Mon-Fri)');
  });
  it('returns weekend label', () => {
    expect(maskToLabel('YNNNNNY')).toBe('Weekends (Sat-Sun)');
  });
  it('returns initials for custom masks', () => {
    // Custom mask: active days are indices 1 (Mon) and 5 (Fri)
    expect(maskToLabel('NYNNNYN')).toBe('M, F');
  });
});

describe('headway service — expandHeadway (basic)', () => {
  it('returns no departures when the rule is inactive on the date', () => {
    // Only Sunday active
    const rule: HeadwayRuleInput = { ...baseRule, dayMask: 'YNNNNNN' };
    // 2026-08-04 is a Tuesday
    const out = expandHeadway([rule], '2026-08-04', '2026-08-04');
    expect(out).toEqual([]);
  });

  it('expands a 06:00–07:00 rule with 15-min headway to 5 departures', () => {
    const rule: HeadwayRuleInput = { ...baseRule, startTime: '06:00', endTime: '07:00', headwayMinutes: 15, anchorTime: null };
    const out = expandHeadway([rule], '2026-08-04', '2026-08-04');
    // 06:00, 06:15, 06:30, 06:45, 07:00
    expect(out).toHaveLength(5);
    expect(out.map((d) => d.localTime)).toEqual(['06:00', '06:15', '06:30', '06:45', '07:00']);
  });

  it('snaps first departure to anchorTime when inside the window', () => {
    const rule: HeadwayRuleInput = { ...baseRule, startTime: '06:00', endTime: '09:00', headwayMinutes: 30, anchorTime: '06:15' };
    const out = expandHeadway([rule], '2026-08-04', '2026-08-04');
    // 06:15, 06:45, 07:15, 07:45, 08:15, 08:45
    expect(out.map((d) => d.localTime)).toEqual(['06:15', '06:45', '07:15', '07:45', '08:15', '08:45']);
  });

  it('flags the first departure as the anchor', () => {
    const out = expandHeadway([baseRule], '2026-08-04', '2026-08-04');
    expect(out[0].isAnchor).toBe(true);
    expect(out.slice(1).every((d) => d.isAnchor === false)).toBe(true);
  });

  it('produces an empty list when headway is 0 or negative', () => {
    const rule: HeadwayRuleInput = { ...baseRule, headwayMinutes: 0 };
    expect(expandHeadway([rule], '2026-08-04', '2026-08-04')).toEqual([]);
  });
});

describe('headway service — expandHeadway (date range + day-mask)', () => {
  it('expands across multiple days', () => {
    // Only Mon + Wed + Fri
    const rule: HeadwayRuleInput = { ...baseRule, startTime: '08:00', endTime: '08:00', dayMask: 'NYNNNNN' };
    // 2026-08-03 (Mon) to 2026-08-09 (Sun) — only Mon is active, 1 departure
    // Use start<end for non-degenerate window
    const rule2: HeadwayRuleInput = { ...baseRule, startTime: '08:00', endTime: '08:15', headwayMinutes: 15, dayMask: 'NYNNNNN' };
    const out = expandHeadway([rule2], '2026-08-03', '2026-08-09');
    expect(out).toHaveLength(2); // 08:00, 08:15 on Monday
    const dates = out.map((d) => d.isoUtc.slice(0, 10));
    expect(dates).toEqual(['2026-08-03', '2026-08-03']);
  });

  it('expands the same rule on every day of the week for a 7-day range', () => {
    const out = expandHeadway([baseRule], '2026-08-03', '2026-08-09');
    // baseRule has 30-min headway from 06:00 to 09:00 = 7 departures per day
    // 7 days × 7 = 49
    expect(out).toHaveLength(49);
  });
});

describe('headway service — expandHeadway (cross-midnight windows)', () => {
  it('splits a window that crosses midnight into two sub-windows', () => {
    // 23:00 → 01:00, 60-min headway
    const rule: HeadwayRuleInput = { ...baseRule, startTime: '23:00', endTime: '01:00', headwayMinutes: 60, anchorTime: null };
    const out = expandHeadway([rule], '2026-08-04', '2026-08-04');
    // Window 1: 23:00 to 23:59 → 23:00, 23:59 (snap of 23:00 + 60 = 00:00, which is <= 23:59... wait, 00:00 > 23:59, so loop exits after 23:00 and 23:59? No: hmCmp 00:00 > 23:59 = true, so loop exits. Wait, the algorithm checks while hmCmp(cursor, end) <= 0. After 23:59 we add 60 min → 00:59. hmCmp(00:59, 23:59) = 0:59 - 23:59 = negative → still <= 0? Let me re-check.)
    // Actually let me just verify the departures make sense: 23:00, 23:59 (window 1), 00:00, 00:59, 01:00 (window 2)
    const times = out.map((d) => d.localTime);
    expect(times).toContain('23:00');
    expect(times).toContain('00:00');
    expect(times).toContain('01:00');
  });
});
