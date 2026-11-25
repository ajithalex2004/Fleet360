import { describe, it, expect, vi } from 'vitest';

// The catalogue module imports the database client; these tests only cover
// its pure parts, so no database is touched.
vi.mock('@/lib/prisma', () => ({ prisma: {} }));

import {
  STANDARD_CATALOG, parseSla, parsePriority, CatalogError,
} from '@/lib/service-tickets/service-catalog';
import { TICKET_TYPE_KEY_RE } from '@/types/service-tickets';
import { formatSlaHours, priorityLabel } from '@/lib/service-tickets/priority-tiers';
import { FACILITIES_CATALOGUE } from '@/lib/service-config/facilities-template';

const types = STANDARD_CATALOG.flatMap((c) => c.types);

describe('FSM standard service catalogue (FSM_Service_Types_and_SLA_Timers-v2.xlsx)', () => {
  it('has the 11 categories and 33 service types of the reference sheet', () => {
    expect(STANDARD_CATALOG).toHaveLength(11);
    expect(types).toHaveLength(33);
    for (const c of STANDARD_CATALOG) expect(c.types).toHaveLength(3);
  });

  it('uses unique, valid keys', () => {
    const keys = [...STANDARD_CATALOG.map((c) => c.key), ...types.map((t) => t.key)];
    expect(new Set(keys).size).toBe(keys.length);
    for (const k of keys) {
      expect(k.startsWith('FSM_')).toBe(true);
      expect(TICKET_TYPE_KEY_RE.test(k)).toBe(true);
    }
  });

  it('gives every type a unique three-letter request prefix that the Facilities catalogue does not use', () => {
    const prefixes = types.map((t) => t.prefix);
    expect(new Set(prefixes).size).toBe(prefixes.length);
    for (const p of prefixes) expect(p).toMatch(/^[A-Z]{3}$/);
    const fm = new Set(FACILITIES_CATALOGUE.flatMap((c) => c.types.map((t) => t.prefix)));
    for (const p of prefixes) expect(fm.has(p)).toBe(false);
  });

  it('matches the sheet\'s priority mix and sample SLA rows', () => {
    const count = (p: string) => types.filter((t) => t.priority === p).length;
    expect([count('Critical'), count('High'), count('Medium'), count('Low')]).toEqual([2, 8, 16, 7]);

    const outage = types.find((t) => t.name === 'Critical Outage / System Down Restoration')!;
    expect([outage.priority, outage.response, outage.onSite, outage.resolution]).toEqual(['Critical', 0.25, 2, 4]);
    const routine = types.find((t) => t.name.startsWith('Routine Scheduled Servicing'))!;
    expect([routine.priority, routine.response, routine.onSite, routine.resolution]).toEqual(['Low', 24, 168, 336]);
  });

  it('never has a resolution target shorter than the response target', () => {
    for (const t of types) {
      expect(t.resolution).toBeGreaterThanOrEqual(t.response);
      expect(t.onSite).toBeGreaterThan(0);
    }
  });
});

describe('catalogue validation', () => {
  it('maps P1–P4 tiers, labels and priority names to ticket priorities', () => {
    expect(parsePriority('P1')).toBe('Critical');
    expect(parsePriority('P2 - High')).toBe('High');
    expect(parsePriority('Medium')).toBe('Medium');
    expect(parsePriority('P4')).toBe('Low');
    expect(() => parsePriority('P9')).toThrow(CatalogError);
  });

  it('accepts positive hours and rejects missing, zero or inverted timers', () => {
    expect(parseSla({ responseHours: '0.25', onSiteHours: 2, resolutionHours: 4 }))
      .toEqual({ responseHours: 0.25, onSiteHours: 2, resolutionHours: 4 });
    expect(() => parseSla({ responseHours: 1, onSiteHours: 4 })).toThrow('Resolution time');
    expect(() => parseSla({ responseHours: 0, onSiteHours: 4, resolutionHours: 8 })).toThrow('Response time');
    expect(() => parseSla({ responseHours: 8, onSiteHours: 4, resolutionHours: 2 })).toThrow('shorter than the response');
    expect(() => parseSla({ responseHours: 1, onSiteHours: 9000, resolutionHours: 9000 })).toThrow('8760');
  });

  it('formats SLA hours for display', () => {
    expect(formatSlaHours(0.25)).toBe('15 min');
    expect(formatSlaHours(4)).toBe('4 h');
    expect(formatSlaHours(168)).toBe('168 h (7 d)');
    expect(formatSlaHours(null)).toBe('—');
    expect(priorityLabel('Critical')).toBe('P1 - Critical');
  });
});
