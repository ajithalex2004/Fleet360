/**
 * lib/headway/service.ts — expand a HeadwayRule set into concrete
 * "next bus" times.
 *
 * What this does:
 *   Given a set of HeadwayRule rows for one route (and an optional
 *   date + day-of-week), produce a flat list of departure times
 *   between `from` and `to` (inclusive) for that route.
 *
 * Algorithm (per rule):
 *   1. Parse the rule's local-time window (startTime, endTime). If the
 *      window crosses midnight (e.g. 23:00 → 02:00), split into two
 *      sub-windows.
 *   2. For each day in [from, to] that is active under the rule's
 *      dayMask, generate the departure times:
 *        - anchor: first departure at the nearest anchor (or at
 *          startTime if no anchor).
 *        - step:    add headwayMinutes until > endTime.
 *
 * The result is a list of ISO timestamps the UI can render as a
 * "next bus" table or feed into the planning engine as a virtual
 * trip-schedule for batch expansion.
 */

export interface HeadwayRuleInput {
  id: string;
  routeId: string;
  dayMask: string;        // 'YYYYYYY' starting Sunday
  startTime: string;      // 'HH:MM'
  endTime: string;        // 'HH:MM'
  headwayMinutes: number;
  anchorTime?: string | null;
}

export interface ExpandedDeparture {
  ruleId: string;
  routeId: string;
  /** Local-time-of-day 'HH:MM' */
  localTime: string;
  /** Full ISO timestamp (UTC) — uses the date from the input window and
   *  the local time from the rule. The engine treats the rule's time
   *  window as local time in the tenant's IANA zone; the API converts
   *  to UTC on the way out. For now, the engine is timezone-naive and
   *  the timestamp is built as if local == UTC. The UI's user-facing
   *  display uses the localTime field so a future timezone awareness
   *  drops in without an API change. */
  isoUtc: string;
  /** Anchor flag — true for the first departure of a window (or the
   *  one nearest to anchorTime, if set). Useful for the UI to mark
   *  the "clock face" beat. */
  isAnchor: boolean;
}

const DAY_NAMES = ['S', 'M', 'T', 'W', 'T', 'F', 'S']; // Sunday..Saturday

/** Parse 'HH:MM' into a {h, m} pair. */
function parseHm(s: string): { h: number; m: number } {
  const [h, m] = s.split(':').map(Number);
  return { h: h || 0, m: m || 0 };
}

/** True if the day-of-week (0=Sun..6=Sat) is enabled under the mask. */
function dayActive(mask: string, dow: number): boolean {
  // mask is 7 chars starting Sunday. Guard against short masks.
  const safe = (mask + 'YYYYYYY').slice(0, 7);
  return safe[dow] === 'Y';
}

/** Add minutes to a 'HH:MM' time string, return a new 'HH:MM'. */
function addMinutesToHm(hm: string, minutes: number): string {
  const { h, m } = parseHm(hm);
  const total = h * 60 + m + minutes;
  const days  = Math.floor(total / (24 * 60));
  const rem   = ((total % (24 * 60)) + 24 * 60) % (24 * 60);
  const nh    = Math.floor(rem / 60);
  const nm    = rem % 60;
  return `${String(nh).padStart(2, '0')}:${String(nm).padStart(2, '0')}`;
}

/** Compare two 'HH:MM' times. */
function hmCmp(a: string, b: string): number {
  const pa = parseHm(a);
  const pb = parseHm(b);
  return (pa.h * 60 + pa.m) - (pb.h * 60 + pb.m);
}

/** Format 'YYYY-MM-DD' + 'HH:MM' as ISO UTC. (Local == UTC for now.) */
function ymdHmToIso(date: string, hm: string): string {
  // Naive: treat the wall time as UTC. The UI uses the separate
  // localTime field for display, so a future timezone-aware upgrade
  // doesn't break API consumers.
  return new Date(`${date}T${hm}:00Z`).toISOString();
}

/** Yield YYYY-MM-DD strings for [from, to] inclusive. */
function* dateRange(from: string, to: string): Generator<string> {
  const a = new Date(from + 'T00:00:00Z');
  const b = new Date(to   + 'T00:00:00Z');
  if (a > b) return;
  for (let d = new Date(a); d <= b; d.setUTCDate(d.getUTCDate() + 1)) {
    yield d.toISOString().slice(0, 10);
  }
}

/** Split a window that may cross midnight into 1 or 2 [start, end] pairs. */
function splitWindow(start: string, end: string): Array<[string, string]> {
  if (hmCmp(start, end) === 0) {
    return [[start, end]]; // degenerate — leave as a zero-length window
  }
  if (hmCmp(start, end) < 0) {
    return [[start, end]];
  }
  // start > end → crosses midnight → split: [start, 23:59] + [00:00, end]
  return [[start, '23:59'], ['00:00', end]];
}

/** Generate the time-of-day departures within one window [start, end],
 *  optionally snapped to anchorTime.
 *
 *  Note: the loop is bounded by a hard iteration cap (24h worth of
 *  departures + 1) to prevent infinite loops when a window crosses
 *  midnight and the cursor wraps to the next day — hmCmp treats the
 *  wrapped value as < end in the same calendar day, which would
 *  otherwise produce an unbounded iteration. */
function expandWindow(
  start: string, end: string, headwayMins: number, anchorTime: string | null | undefined,
): string[] {
  if (headwayMins < 1) return [];
  const result: string[] = [];

  // Snap first departure to anchor if provided, otherwise use start.
  let cursor = anchorTime && hmCmp(anchorTime, start) >= 0 && hmCmp(anchorTime, end) <= 0
    ? anchorTime
    : start;

  // If the anchor is before start, step forward until >= start.
  while (hmCmp(cursor, start) < 0) {
    cursor = addMinutesToHm(cursor, headwayMins);
  }

  // Hard cap: 24 hours' worth of departures + a fudge factor. Beyond
  // that, the window is malformed (or the cursor has wrapped) — stop.
  const maxIter = Math.ceil((24 * 60) / headwayMins) + 2;
  let iter = 0;
  while (iter < maxIter && hmCmp(cursor, end) <= 0) {
    result.push(cursor);
    cursor = addMinutesToHm(cursor, headwayMins);
    iter++;
  }
  return result;
}

/**
 * Expand a set of rules for a single route into a flat list of
 * departures within the [from, to] window.
 */
export function expandHeadway(
  rules: HeadwayRuleInput[],
  from: string,
  to: string,
): ExpandedDeparture[] {
  const out: ExpandedDeparture[] = [];
  for (const date of dateRange(from, to)) {
    const dow = new Date(date + 'T00:00:00Z').getUTCDay(); // 0=Sun..6=Sat
    for (const rule of rules) {
      if (!dayActive(rule.dayMask, dow)) continue;
      for (const [subStart, subEnd] of splitWindow(rule.startTime, rule.endTime)) {
        const times = expandWindow(subStart, subEnd, rule.headwayMinutes, rule.anchorTime);
        times.forEach((hm, i) => {
          out.push({
            ruleId: rule.id,
            routeId: rule.routeId,
            localTime: hm,
            isoUtc: ymdHmToIso(date, hm),
            isAnchor: i === 0,
          });
        });
      }
    }
  }
  // Sort by ISO timestamp (chronological)
  out.sort((a, b) => a.isoUtc.localeCompare(b.isoUtc));
  return out;
}

/** Helper: derive the day-mask from a list of day indices (0=Sun..6=Sat). */
export function daysToMask(days: number[]): string {
  const mask = 'NNNNNNN';
  return days.reduce((acc, d) => {
    if (d < 0 || d > 6) return acc;
    return acc.slice(0, d) + 'Y' + acc.slice(d + 1);
  }, mask);
}

/** Helper: parse a 7-char mask into a list of day indices. */
export function maskToDays(mask: string): number[] {
  return mask.split('').map((c, i) => c === 'Y' ? i : -1).filter((i) => i >= 0);
}

/** Pretty-print a 7-char mask as a comma-separated list of day names. */
export function maskToLabel(mask: string): string {
  const days = maskToDays(mask);
  if (days.length === 7) return 'Every day';
  if (days.length === 0) return 'Never';
  if (days.length === 5 && [1, 2, 3, 4, 5].every((d) => days.includes(d))) return 'Weekdays (Mon-Fri)';
  if (days.length === 2 && [0, 6].every((d) => days.includes(d))) return 'Weekends (Sat-Sun)';
  return days.map((d) => DAY_NAMES[d]).join(', ');
}
