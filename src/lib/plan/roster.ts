/**
 * roster.ts — Automated rostering algorithm.
 *
 * What rostering is:
 *   Take a set of runs (one day's worth per driver) and assign them to
 *   drivers in a weekly pattern. Common patterns:
 *     - 5 consecutive work days + 2 days off (5/2)
 *     - 4 work days (10h shifts) + 3 days off (4/3)
 *     - Rotating shift pattern (MORNING, MORNING, EVENING, EVENING, OFF, OFF, OFF)
 *
 * The output is a per-driver weekly schedule: which runs they work, which
 * days are off, total hours, OT hours.
 *
 * Algorithm (greedy round-robin with rest-day enforcement):
 *   1. Sort runs by date, then by start time
 *   2. For each day, assign runs to drivers respecting the pattern
 *   3. A driver can have at most one run per day
 *   4. After a driver works a "working day" in the pattern, mark the
 *      next "rest days" as off
 *   5. If a day has more runs than drivers in the pool, leave surplus
 *      unassigned (an over-staffed day, surfaced in the report)
 *
 * This is a standard heuristic. For full CBA-grade optimisation we'd
 * swap this for a CP-SAT or Gurobi model.
 */

import type { Run } from './runcut';
import { DEFAULT_WORK_RULES, type WorkRules } from './runcut';

export type RosterPattern = '5/2' | '4/3' | '6/1' | 'CUSTOM';

export interface RosterDriver {
  id: string;
  name: string;
  /** License type — used to filter runs that require a specific license.
   *  Currently informational; the algorithm doesn't enforce license matching
   *  in this first cut. */
  licenseType?: string | null;
  /** Pattern to apply. Default '5/2'. */
  pattern?: RosterPattern;
  /** Custom pattern as a 7-character string of 'W' (work) and 'O' (off)
   *  starting from the first day of the week. Used when pattern='CUSTOM'. */
  customPattern?: string;
  /** Weekly hour cap (e.g. 48 for full-time). Default 48. */
  weeklyHourCap?: number;
}

export interface RosterDay {
  date: string;          // YYYY-MM-DD
  runIds: string[];      // run ids assigned to this driver on this day
  isRestDay: boolean;    // true if pattern marks this as off
}

export interface DriverRoster {
  driverId: string;
  driverName: string;
  pattern: RosterPattern;
  customPattern?: string;
  days: RosterDay[];     // 7 entries for Mon..Sun (or week-aligned)
  weekStart: string;     // YYYY-MM-DD of the Monday (or first day) of this roster week
  totalWorkMins: number;
  totalPayHours: number;
  notes: string[];
}

export interface RosterResult {
  rosters: DriverRoster[];
  unassignedRunIds: string[]; // runs that didn't fit any driver-day slot
  summary: {
    runCount: number;
    driverCount: number;
    avgRunsPerDriver: number;
    totalWorkHours: number;
    overtimeHours: number;
  };
}

// ── Helpers ─────────────────────────────────────────────────────────────────

function ymd(iso: string): string { return iso.slice(0, 10); }

// Compute the Monday of the week containing `isoDate`.
// Returns YYYY-MM-DD.
function mondayOf(isoDate: string): string {
  const d = new Date(isoDate);
  const day = d.getUTCDay(); // 0=Sun..6=Sat
  const diff = (day === 0 ? -6 : 1 - day); // shift to Monday
  d.setUTCDate(d.getUTCDate() + diff);
  return d.toISOString().slice(0, 10);
}

function addDays(ymdStr: string, n: number): string {
  const d = new Date(ymdStr);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}

function patternToMask(pattern: RosterPattern, custom?: string): string {
  if (pattern === '5/2') return 'WWWWWOO';
  if (pattern === '4/3') return 'WWWWOOO';
  if (pattern === '6/1') return 'WWWWWW O'.replace(' ', ''); // 'WWWWWW O' typo guard
  if (pattern === 'CUSTOM') {
    if (!custom || custom.length !== 7) return 'WWWWWOO';
    return custom.toUpperCase();
  }
  return 'WWWWWOO';
}

export interface RosterOptions {
  /** Pattern to apply for all drivers unless they override. Default '5/2'. */
  defaultPattern?: RosterPattern;
}

export function roster(
  runs: Run[],
  drivers: RosterDriver[],
  opts: RosterOptions = {},
  rules: WorkRules = DEFAULT_WORK_RULES,
): RosterResult {
  const defaultPattern: RosterPattern = opts.defaultPattern ?? '5/2';
  const unassigned: string[] = [];

  // 1. Sort runs by date
  const sortedRuns = [...runs].sort((a, b) => a.date.localeCompare(b.date));

  // 2. Group runs by date
  const byDate = new Map<string, Run[]>();
  for (const r of sortedRuns) {
    if (!byDate.has(r.date)) byDate.set(r.date, []);
    byDate.get(r.date)!.push(r);
  }

  // 3. For each driver, build a 7-day weekly slot map starting from the
  //    earliest run's week's Monday.
  const allDates = [...byDate.keys()].sort();
  if (allDates.length === 0) {
    return {
      rosters: drivers.map((d) => ({
        driverId: d.id, driverName: d.name, pattern: d.pattern ?? defaultPattern,
        days: [], weekStart: '', totalWorkMins: 0, totalPayHours: 0, notes: [],
      })),
      unassignedRunIds: [], summary: { runCount: 0, driverCount: drivers.length, avgRunsPerDriver: 0, totalWorkHours: 0, overtimeHours: 0 },
    };
  }
  const weekStart = mondayOf(allDates[0]);

  // 4. For each driver, build an empty 7-day map
  type DaySlot = { isRestDay: boolean; assignedRunIds: string[]; };
  type DriverSlot = { driver: RosterDriver; weekStart: string; days: DaySlot[]; weekMins: number; };

  const slots: DriverSlot[] = drivers.map((d) => {
    const pattern = d.pattern ?? defaultPattern;
    const mask = patternToMask(pattern, d.customPattern);
    const days: DaySlot[] = Array.from({ length: 7 }, (_, i) => ({
      isRestDay: mask[i] === 'O',
      assignedRunIds: [],
    }));
    return { driver: d, weekStart, days, weekMins: 0 };
  });

  // 5. Assign runs in date order, cycling through drivers. For each run:
  //    a) find the index in its date's days (0=Mon..6=Sun)
  //    b) find a driver whose day is not a rest day, has no run already, and
  //       weekly cap not exceeded
  for (const date of allDates) {
    const dayIdx = (new Date(date).getUTCDay() + 6) % 7; // shift to Mon=0
    const dayRuns = byDate.get(date) ?? [];
    let driverIdx = 0;
    for (const run of dayRuns) {
      let assigned = false;
      for (let i = 0; i < slots.length; i++) {
        const candidate = slots[(driverIdx + i) % slots.length];
        const day = candidate.days[dayIdx];
        if (day.isRestDay) continue;
        if (day.assignedRunIds.length > 0) continue; // one run per day per driver
        const cap = candidate.driver.weeklyHourCap ?? 48;
        if ((candidate.weekMins + run.workMins) / 60 > cap) continue;
        // OK to assign
        day.assignedRunIds.push(run.id);
        candidate.weekMins += run.workMins;
        assigned = true;
        break;
      }
      if (!assigned) unassigned.push(run.id);
      driverIdx++;
    }
  }

  // 6. Materialize DriverRoster with summary stats
  const rosters: DriverRoster[] = slots.map((s) => {
    const totalWorkMins = s.days.reduce((sum, d) => {
      const runId = d.assignedRunIds[0];
      if (!runId) return sum;
      const r = sortedRuns.find((x) => x.id === runId);
      return sum + (r?.workMins ?? 0);
    }, 0);
    const totalPayHours = s.days.reduce((sum, d) => {
      const runId = d.assignedRunIds[0];
      if (!runId) return sum;
      const r = sortedRuns.find((x) => x.id === runId);
      return sum + (r?.payMins ?? 0) / 60;
    }, 0);
    const overtimeHours = s.days.reduce((sum, d) => {
      const runId = d.assignedRunIds[0];
      if (!runId) return sum;
      const r = sortedRuns.find((x) => x.id === runId);
      return sum + (r?.overtimeMins ?? 0) / 60;
    }, 0);
    const notes: string[] = [];
    if (overtimeHours > 0) {
      notes.push(`${overtimeHours.toFixed(1)}h of OT in the week`);
    }
    if (totalPayHours > (s.driver.weeklyHourCap ?? 48)) {
      notes.push(`Over the ${s.driver.weeklyHourCap ?? 48}h weekly cap`);
    }
    return {
      driverId: s.driver.id,
      driverName: s.driver.name,
      pattern: s.driver.pattern ?? defaultPattern,
      customPattern: s.driver.customPattern,
      weekStart,
      days: s.days.map((d, i) => ({
        date: addDays(weekStart, i),
        runIds: d.assignedRunIds,
        isRestDay: d.isRestDay,
      })),
      totalWorkMins,
      totalPayHours: Math.round(totalPayHours * 10) / 10,
      notes,
    };
  });

  // 7. Summary
  const totalWorkHours = rosters.reduce((s, r) => s + r.totalWorkMins, 0) / 60;
  const totalOT = rosters.reduce((s, r) => {
    return s + r.days.reduce((sum, d) => {
      const runId = d.runIds[0];
      if (!runId) return sum;
      const run = sortedRuns.find((x) => x.id === runId);
      return sum + (run?.overtimeMins ?? 0) / 60;
    }, 0);
  }, 0);
  const assigned = sortedRuns.length - unassigned.length;
  return {
    rosters,
    unassignedRunIds: unassigned,
    summary: {
      runCount: assigned,
      driverCount: drivers.length,
      avgRunsPerDriver: drivers.length === 0 ? 0 : assigned / drivers.length,
      totalWorkHours: Math.round(totalWorkHours * 10) / 10,
      overtimeHours: Math.round(totalOT * 10) / 10,
    },
  };
}
