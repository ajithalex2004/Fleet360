/**
 * Tab resolution for the Planning Engine page.
 *
 * The active tab comes from `?tab=`, which is user-supplied — a stale
 * bookmark, a hand-edited URL, or a link written before a rename all
 * arrive here. The page renders exactly one panel keyed off this value,
 * so an unhandled input means a blank page rather than a wrong one.
 */

import { describe, it, expect } from 'vitest';
import {
  resolvePlanningEngineTab,
  planningEngineHref,
  PLANNING_ENGINE_TAB_IDS,
  PLANNING_ENGINE_DEFAULT_TAB,
} from '@/lib/bus-ops/planning-engine-tabs';

describe('resolvePlanningEngineTab', () => {
  it.each(PLANNING_ENGINE_TAB_IDS)('passes through the known tab %s', (id) => {
    expect(resolvePlanningEngineTab(id)).toBe(id);
  });

  it('defaults to Planning Core, not the first tab', () => {
    // The ordering/default split is deliberate: CBA is listed first
    // because it is upstream in the data flow, but Planning Core is the
    // daily task and so is what opens. A regression here would land
    // every visit on a rarely-used config screen.
    expect(PLANNING_ENGINE_DEFAULT_TAB).toBe('core');
    expect(PLANNING_ENGINE_TAB_IDS[0]).toBe('cba');
    expect(resolvePlanningEngineTab(null)).toBe('core');
  });

  it.each([
    ['undefined',      undefined],
    ['null',           null],
    ['empty string',   ''],
    ['whitespace',     '   '],
    ['unknown tab',    'roster'],
    ['old page name',  'plan'],
    ['partial match',  'cb'],
    ['junk',           '../../etc/passwd'],
  ])('falls back to the default for %s', (_label, input) => {
    expect(resolvePlanningEngineTab(input as string | null | undefined))
      .toBe(PLANNING_ENGINE_DEFAULT_TAB);
  });

  it('tolerates casing and surrounding whitespace', () => {
    expect(resolvePlanningEngineTab('CBA')).toBe('cba');
    expect(resolvePlanningEngineTab(' Headway ')).toBe('headway');
    expect(resolvePlanningEngineTab('Core')).toBe('core');
  });

  it('never returns a value outside the declared set', () => {
    const allowed = new Set<string>(PLANNING_ENGINE_TAB_IDS);
    for (const input of ['cba', 'x', '', '  CORE ', 'headway', '0', 'null']) {
      expect(allowed.has(resolvePlanningEngineTab(input))).toBe(true);
    }
  });
});

describe('planningEngineHref', () => {
  it.each(PLANNING_ENGINE_TAB_IDS)('round-trips %s through the querystring', (id) => {
    const href = planningEngineHref(id);
    expect(href).toBe(`/bus-ops/planning-engine?tab=${id}`);
    // The redirects rely on this: a legacy route builds an href here and
    // the page must resolve it back to the same tab.
    const raw = new URL(href, 'http://x').searchParams.get('tab');
    expect(resolvePlanningEngineTab(raw)).toBe(id);
  });
});
