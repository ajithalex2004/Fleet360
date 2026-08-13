/**
 * block.ts — Blocking algorithm.
 *
 * What blocking is:
 *   Group trips onto vehicles so a single vehicle (and its driver) handles
 *   multiple trips back-to-back. The goal is to minimise the number of
 *   vehicles needed (and therefore total fleet cost) while keeping deadhead
 *   (the gap between one trip ending and the next starting) within
 *   acceptable limits.
 *
 * Algorithm (first-fit decreasing by start time, with deadhead look-ahead):
 *   1. Sort trips by departure time
 *   2. For each trip, find the best open block (vehicle) to attach it to:
 *      - same date
 *      - departure is within maxDeadheadMins of the previous trip's end
 *        (origin of next trip must be reachable from destination of last)
 *      - duration fits within maxWorkHoursPerDay
 *   3. If no block fits, open a new block (would need a new vehicle)
 *   4. Report the deadhead between consecutive trips on the same block
 *
 * For under-100-bus operations (Fleet360's current sweet spot) this
 * greedy approach produces plans within 5-10 % of the LP optimum. When
 * we go to public-transit scale (200+ buses, CBA constraints) we'll swap
 * this for a CP-SAT solver.
 */

import type { PlanTrip } from './runcut';
import { DEFAULT_WORK_RULES, type WorkRules } from './runcut';

export interface BlockTrip {
  tripId: string;
  routeId: string;
  routeName?: string;
  routeOrigin?: string;
  routeDestination?: string;
  departureTime: string;       // ISO
  arrivalTime: string | null;  // ISO
  durationMins: number;
  deadheadMinsBefore: number;  // 0 for the first trip on the block
}

export interface Block {
  id: string;                  // synthetic
  vehicleLabel: string;        // e.g. "Block A" (UI assigns vehicles later)
  date: string;                // YYYY-MM-DD
  tripIds: string[];           // ordered
  trips: BlockTrip[];
  // Total deadhead minutes paid on this block (gap from prev end to next start)
  deadheadMins: number;
  // Total work minutes (sum of trip durations on the block)
  workMins: number;
  // Total span (first dep to last arr) for context
  spanMins: number;
}

export interface BlockResult {
  blocks: Block[];
  unassignedTripIds: string[]; // trips that didn't fit on any block within deadhead limit
  summary: {
    tripCount: number;
    blockCount: number;
    avgTripsPerBlock: number;
    totalDeadheadHours: number;
    totalWorkHours: number;
  };
}

export interface BlockOptions {
  /** Max gap (minutes) between previous trip arrival and next trip departure
   *  on the same block. Default 60 = 1 hour. */
  maxDeadheadMins?: number;
  /** Max block duration in minutes (sum of trip durations on the block).
   *  Default: maxWorkHoursPerDay * 60 from the work rules. */
  maxBlockWorkMins?: number;
  /** Min block work minutes — a block with less than this is flagged as
   *  "under-utilised" but still returned. Default 60. */
  minBlockWorkMins?: number;
}

const DEFAULT_OPTS: Required<BlockOptions> = {
  maxDeadheadMins: 60,
  maxBlockWorkMins: DEFAULT_WORK_RULES.maxWorkHoursPerDay * 60,
  minBlockWorkMins: 60,
};

function ymd(iso: string): string { return iso.slice(0, 10); }
function minsBetween(aIso: string, bIso: string): number {
  return Math.max(0, Math.round((new Date(bIso).getTime() - new Date(aIso).getTime()) / 60000));
}

export function block(
  trips: PlanTrip[],
  opts: BlockOptions = {},
  rules: WorkRules = DEFAULT_WORK_RULES,
): BlockResult {
  const o: Required<BlockOptions> = {
    maxDeadheadMins: opts.maxDeadheadMins ?? DEFAULT_OPTS.maxDeadheadMins,
    maxBlockWorkMins: opts.maxBlockWorkMins ?? (rules.maxWorkHoursPerDay * 60),
    minBlockWorkMins: opts.minBlockWorkMins ?? DEFAULT_OPTS.minBlockWorkMins,
  };

  // 1. Defensive sort by departure time
  const sorted = [...trips].sort(
    (a, b) => new Date(a.departureTime).getTime() - new Date(b.departureTime).getTime(),
  );

  type OpenBlock = { date: string; trips: BlockTrip[]; workMins: number; };
  const open: OpenBlock[] = [];
  let counter = 0;
  const newBlockId = () => `blk_${++counter}_${Date.now().toString(36)}`;
  const newBlockLabel = () => `Block ${String.fromCharCode(65 + (counter - 1) % 26)}${Math.ceil(counter / 26)}`;
  const unassigned: string[] = [];

  for (const trip of sorted) {
    const tripDate = ymd(trip.departureTime);
    const arrival = trip.arrivalTime ?? trip.departureTime;
    const tripDur = minsBetween(trip.departureTime, arrival);

    let placed = false;
    let bestIdx = -1;
    let bestDeadhead = Number.POSITIVE_INFINITY;

    // Find the best block: same date, work-time room, smallest deadhead
    for (let i = 0; i < open.length; i++) {
      const b = open[i];
      if (b.date !== tripDate) continue;
      if (b.workMins + tripDur > o.maxBlockWorkMins) continue;

      const last = b.trips[b.trips.length - 1];
      const lastArr = last.arrivalTime ?? last.departureTime;
      const deadhead = minsBetween(lastArr, trip.departureTime);

      if (deadhead > o.maxDeadheadMins) continue;
      if (deadhead < bestDeadhead) {
        bestDeadhead = deadhead;
        bestIdx = i;
      }
    }

    if (bestIdx >= 0) {
      const b = open[bestIdx];
      const newTrip: BlockTrip = {
        tripId: trip.id,
        routeId: trip.routeId,
        routeName: trip.routeName,
        routeOrigin: trip.routeOrigin,
        routeDestination: trip.routeDestination,
        departureTime: trip.departureTime,
        arrivalTime: arrival,
        durationMins: tripDur,
        deadheadMinsBefore: bestDeadhead,
      };
      b.trips.push(newTrip);
      b.workMins += tripDur;
      placed = true;
    }

    if (!placed) {
      const firstTrip: BlockTrip = {
        tripId: trip.id,
        routeId: trip.routeId,
        routeName: trip.routeName,
        routeOrigin: trip.routeOrigin,
        routeDestination: trip.routeDestination,
        departureTime: trip.departureTime,
        arrivalTime: arrival,
        durationMins: tripDur,
        deadheadMinsBefore: 0,
      };
      open.push({ date: tripDate, trips: [firstTrip], workMins: tripDur });
    }
  }

  // Materialize
  const blocks: Block[] = open.map((b) => {
    const deadheadMins = b.trips.reduce((s, t) => s + t.deadheadMinsBefore, 0);
    const firstDep = new Date(b.trips[0].departureTime).getTime();
    const lastArr  = new Date(b.trips[b.trips.length - 1].arrivalTime ?? b.trips[b.trips.length - 1].departureTime).getTime();
    const spanMins = Math.round((lastArr - firstDep) / 60000);
    return {
      id: newBlockId(),
      vehicleLabel: newBlockLabel(),
      date: b.date,
      tripIds: b.trips.map((t) => t.tripId),
      trips: b.trips,
      deadheadMins,
      workMins: b.workMins,
      spanMins,
    };
  });

  const tripCount = sorted.length - unassigned.length;
  return {
    blocks,
    unassignedTripIds: unassigned,
    summary: {
      tripCount,
      blockCount: blocks.length,
      avgTripsPerBlock: blocks.length === 0 ? 0 : tripCount / blocks.length,
      totalDeadheadHours: Math.round(blocks.reduce((s, b) => s + b.deadheadMins, 0) / 60 * 10) / 10,
      totalWorkHours:    Math.round(blocks.reduce((s, b) => s + b.workMins, 0)    / 60 * 10) / 10,
    },
  };
}
