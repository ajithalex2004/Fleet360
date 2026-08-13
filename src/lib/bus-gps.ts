/**
 * bus-gps — Staff-Transport GPS ingest + geofence-driven stop-visit tracking.
 *
 * The bus module didn't have GPS. This file adds it:
 *
 *   1. Pure evaluator (evaluateStopTransitions) — given the current ping, the
 *      prior visit state, and the route's stops, returns what transitions
 *      just happened (approach, arrival, departure) plus the new visit rows
 *      to upsert. No DB, no network — same shape as logistics/geofence.ts so
 *      it stays unit-testable.
 *
 *   2. Table-ensure helper (ensureBusGpsTables) — creates bus_gps_pings and
 *      trip_stop_visits + adds geofence_radius_m to route_stops if the DB
 *      hasn't picked up the Prisma migration yet. Same pattern as
 *      ensureLogisticsDomainTables so the endpoints can be dropped in on a
 *      dev/staging DB without a manual migration step.
 *
 * NOTE (2026-08-13): the ensureBusGpsTables() lazy DDL helper was
 * removed. Table shapes now live in prisma/raw/*.sql migrations
 * (`move_bus_gps_pings_to_fleet.sql`,
 *  `add_trip_stop_visits_and_bus_gps_deps.sql`) that any env is
 * expected to apply out-of-band. Endpoints call evaluateStopTransitions
 * directly against tables that already exist.
 */

import { prisma } from './prisma';

// ── Constants ────────────────────────────────────────────────────────────────

/** Radius at which a bus is treated as "at the stop" (metres). Overridable
 *  per-stop via route_stops.geofence_radius_m. */
export const DEFAULT_ARRIVAL_RADIUS_M = 100;

/** Larger radius at which passengers get a "your bus is arriving" notification.
 *  Chosen so a bus doing 40 km/h has ~72s of warning; adjust per tenant later. */
export const DEFAULT_APPROACH_RADIUS_M = 800;

// ── Types ────────────────────────────────────────────────────────────────────

export interface BusPing {
  latitude: number;
  longitude: number;
  occurredAt: string; // ISO
}

export interface StopWithGeo {
  id: string;
  sequence: number;
  stopName: string;
  gpsLat: number;
  gpsLng: number;
  /** Per-stop override; falls back to DEFAULT_ARRIVAL_RADIUS_M when null. */
  geofenceRadiusM: number | null;
}

export interface PriorVisit {
  stopId: string;
  approachedAt: string | null;
  enteredAt: string | null;
  leftAt: string | null;
  approachNotifiedAt: string | null;
}

export type StopTransition =
  | { type: 'APPROACH'; stopId: string; stopName: string; distanceM: number; occurredAt: string }
  | { type: 'ENTER';    stopId: string; stopName: string; distanceM: number; occurredAt: string }
  | { type: 'EXIT';     stopId: string; stopName: string; distanceM: number; occurredAt: string };

export interface VisitPatch {
  stopId: string;
  approachedAt?: string;
  enteredAt?: string;
  leftAt?: string;
}

export interface EvaluateOutput {
  transitions: StopTransition[];
  visitPatches: VisitPatch[];
}

// ── Geometry ─────────────────────────────────────────────────────────────────

const EARTH_RADIUS_M = 6_371_000;

/** Haversine distance in metres between two lat/lng points. Inlined to keep
 *  this module dependency-free (logistics/distance-matrix returns km; using
 *  metres directly here avoids repeated * 1000 conversions in the evaluator). */
export function haversineM(a: { latitude: number; longitude: number }, b: { latitude: number; longitude: number }): number {
  const toRad = (deg: number) => (deg * Math.PI) / 180;
  const dLat = toRad(b.latitude - a.latitude);
  const dLng = toRad(b.longitude - a.longitude);
  const lat1 = toRad(a.latitude);
  const lat2 = toRad(b.latitude);
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(lat1) * Math.cos(lat2) * Math.sin(dLng / 2) ** 2;
  return 2 * EARTH_RADIUS_M * Math.asin(Math.sqrt(h));
}

// ── Evaluator ────────────────────────────────────────────────────────────────

/**
 * Given the latest ping + prior visit state + all stops on the route, return
 * (a) what transitions the ping caused and (b) which visit rows to upsert.
 *
 * Transitions fire ONCE per (scheduleId, stopId) per state change:
 *   APPROACH — first ping ever inside pre-notify radius AND no prior approach recorded
 *   ENTER    — first ping inside arrival radius AND no prior enter recorded
 *   EXIT     — a ping outside arrival radius after an ENTER was recorded, AND no prior exit recorded
 *
 * Doing state transitions in a pure function (not "if inside, notify") is what
 * keeps a bus idling at a stop from spamming a fresh event on every ping.
 */
export function evaluateStopTransitions(
  ping: BusPing,
  stops: StopWithGeo[],
  priorVisits: PriorVisit[],
  opts?: { approachRadiusM?: number; arrivalRadiusMFallback?: number },
): EvaluateOutput {
  const approachRadius = opts?.approachRadiusM ?? DEFAULT_APPROACH_RADIUS_M;
  const arrivalFallback = opts?.arrivalRadiusMFallback ?? DEFAULT_ARRIVAL_RADIUS_M;

  const priorByStop = new Map(priorVisits.map(v => [v.stopId, v]));
  const transitions: StopTransition[] = [];
  const visitPatches: VisitPatch[] = [];

  for (const stop of stops) {
    if (stop.gpsLat == null || stop.gpsLng == null) continue;
    const distanceM = haversineM(
      { latitude: ping.latitude, longitude: ping.longitude },
      { latitude: stop.gpsLat, longitude: stop.gpsLng },
    );

    const arrivalRadius = stop.geofenceRadiusM ?? arrivalFallback;
    const insideArrival = distanceM <= arrivalRadius;
    const insideApproach = distanceM <= approachRadius;

    const prior = priorByStop.get(stop.id);

    // APPROACH — first time we see the bus inside the pre-notify radius.
    if (insideApproach && !prior?.approachedAt) {
      transitions.push({ type: 'APPROACH', stopId: stop.id, stopName: stop.stopName, distanceM, occurredAt: ping.occurredAt });
      visitPatches.push({ stopId: stop.id, approachedAt: ping.occurredAt });
    }

    // ENTER — first time inside the arrival radius.
    if (insideArrival && !prior?.enteredAt) {
      transitions.push({ type: 'ENTER', stopId: stop.id, stopName: stop.stopName, distanceM, occurredAt: ping.occurredAt });
      const patch = visitPatches.find(p => p.stopId === stop.id) ?? { stopId: stop.id };
      patch.enteredAt = ping.occurredAt;
      // Enter implies approach (bus that teleports past the outer ring — GPS
      // gap — still gets an approachedAt so downstream reasoning is coherent).
      if (!prior?.approachedAt && !patch.approachedAt) patch.approachedAt = ping.occurredAt;
      if (!visitPatches.find(p => p.stopId === stop.id)) visitPatches.push(patch);
    }

    // EXIT — outside arrival radius after having entered.
    if (!insideArrival && prior?.enteredAt && !prior?.leftAt) {
      transitions.push({ type: 'EXIT', stopId: stop.id, stopName: stop.stopName, distanceM, occurredAt: ping.occurredAt });
      visitPatches.push({ stopId: stop.id, leftAt: ping.occurredAt });
    }
  }

  return { transitions, visitPatches };
}

// ensureBusGpsTables() removed 2026-08-13 — DDL now lives in
// prisma/raw/*.sql migrations (see file header). Endpoints assume the
// tables exist. If you're bootstrapping a fresh env, apply the raw
// SQL files in commit order before starting the server.
