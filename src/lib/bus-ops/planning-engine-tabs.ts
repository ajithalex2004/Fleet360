/**
 * Tab identity for the Planning Engine page.
 *
 * Split out of the page component so the resolution rules are testable
 * without mounting React — the page reads `?tab=` straight off the
 * querystring, which is user-supplied and therefore has to degrade
 * safely rather than render an empty shell.
 */

// Kept in the same order as the TABS array in planning-engine/page.tsx —
// this is a second source of truth for tab identity, not just a list of
// valid ids, so letting the two orderings drift would be misleading.
export const PLANNING_ENGINE_TAB_IDS = ['cba', 'core', 'headway'] as const;

export type PlanningEngineTabId = typeof PLANNING_ENGINE_TAB_IDS[number];

/**
 * Planning Core is the landing tab even though it isn't listed first.
 *
 * Visual order follows the data flow — labour rules feed the plan, and
 * Planning Core pre-fills its WorkRules from the default CBA rule-set.
 * But Planning Core is the daily-driver task while the other two are
 * configured rarely, so opening on a config screen would tax the
 * frequent job on every visit.
 */
export const PLANNING_ENGINE_DEFAULT_TAB: PlanningEngineTabId = 'core';

const VALID = new Set<string>(PLANNING_ENGINE_TAB_IDS);

/**
 * Map a raw `?tab=` value to a tab to render.
 *
 * Anything unrecognised — absent, empty, misspelled, a stale link from
 * before a rename, or hand-edited junk — falls back to the default
 * rather than rendering no panel at all.
 */
export function resolvePlanningEngineTab(raw: string | null | undefined): PlanningEngineTabId {
  if (typeof raw !== 'string') return PLANNING_ENGINE_DEFAULT_TAB;
  const trimmed = raw.trim().toLowerCase();
  return VALID.has(trimmed)
    ? (trimmed as PlanningEngineTabId)
    : PLANNING_ENGINE_DEFAULT_TAB;
}

/** Canonical href for a tab — used by the redirects and the nav tiles. */
export function planningEngineHref(tab: PlanningEngineTabId): string {
  return `/bus-ops/planning-engine?tab=${tab}`;
}
