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
  /** Local-time-of-day 'HH:MM' — as authored in the rule. */
  localTime: string;
  /** Full ISO timestamp (UTC). When `tz` is passed to expandHeadway(),
   *  the rule's wall-clock localTime is interpreted in that IANA zone
   *  (DST-aware) and converted to UTC. Without `tz`, the legacy
   *  UTC-as-local behaviour is preserved for backward compatibility. */
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

/**
 * Format 'YYYY-MM-DD' + 'HH:MM' as an ISO UTC instant.
 *
 * When `tz` is a valid IANA zone (e.g. 'Asia/Dubai'), interpret the
 * wall clock as *local time in that zone* (DST-aware) and convert to
 * UTC. When `tz` is null/undefined, fall back to the legacy behaviour
 * of treating the wall time as UTC — required for back-compat with
 * pre-R3 callers that don't yet pass a timezone.
 *
 * Algorithm (DST-aware, no external deps):
 *   1. Interpret the wall clock as if it were UTC → candidate instant.
 *   2. Ask Intl.DateTimeFormat what wall-clock time the candidate
 *      shows in the target zone.
 *   3. The delta between the shown value and the candidate is the
 *      zone's UTC offset at that instant.
 *   4. Adjust: subtract the offset from the candidate to land on the
 *      real UTC instant whose zone-local rendering matches the input.
 *
 * Handles DST fall-back / spring-forward gaps by defaulting to the
 * before-transition offset (same behaviour as the browser's Date
 * constructor with a local time in an ambiguous window).
 */
function ymdHmToIso(date: string, hm: string, tz?: string | null): string {
  if (!tz) {
    // Legacy: treat wall time as UTC.
    return new Date(`${date}T${hm}:00Z`).toISOString();
  }
  const [y, m, d]     = date.split('-').map(Number);
  const { h, m: min } = parseHm(hm);
  const candidate     = Date.UTC(y, (m || 1) - 1, d || 1, h, min);
  const shown         = zoneWallClockAsUtc(new Date(candidate), tz);
  const offsetMs      = shown - candidate;
  return new Date(candidate - offsetMs).toISOString();
}

/**
 * Given a Date and an IANA timezone, return the UTC timestamp that
 * would encode the *wall-clock* the zone shows at that instant. Used
 * by ymdHmToIso() to compute a zone's offset without pulling in a
 * date-fns-tz or luxon dependency.
 */
function zoneWallClockAsUtc(instant: Date, tz: string): number {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone:  tz,
    hour12:    false,
    year:      'numeric',
    month:     '2-digit',
    day:       '2-digit',
    hour:      '2-digit',
    minute:    '2-digit',
    second:    '2-digit',
  }).formatToParts(instant);
  const get = (type: string) => Number(parts.find(p => p.type === type)?.value ?? 0);
  // Intl's 'hour' returns 24 for midnight in en-CA — normalise to 0.
  const hour = get('hour') === 24 ? 0 : get('hour');
  return Date.UTC(get('year'), get('month') - 1, get('day'), hour, get('minute'), get('second'));
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
 *
 * @param tz  Optional IANA timezone (e.g. 'Asia/Dubai'). When set, the
 *            rule's wall-clock times are interpreted in that zone and
 *            converted to UTC on the way out — DST-aware. When null,
 *            legacy UTC-as-local behaviour is preserved for back-compat
 *            with callers that don't yet thread tenant timezone through.
 */
export function expandHeadway(
  rules: HeadwayRuleInput[],
  from: string,
  to: string,
  tz?: string | null,
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
            ruleId:    rule.id,
            routeId:   rule.routeId,
            localTime: hm,
            isoUtc:    ymdHmToIso(date, hm, tz),
            isAnchor:  i === 0,
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
