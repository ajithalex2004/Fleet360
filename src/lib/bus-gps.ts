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
 * The endpoint layer calls ensureBusGpsTables() once (memoised) then hands
 * every ping to evaluateStopTransitions() to derive what changed.
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

// ── Table-ensure helper (raw SQL init) ───────────────────────────────────────

let ensured = false;

/**
 * Create the two new tables + the RouteStop column addition if a Prisma
 * migration hasn't run yet. Memoised so subsequent hits are free. Matches the
 * ensureLogisticsDomainTables pattern already used elsewhere; a proper
 * `prisma migrate deploy` still supersedes this for production.
 */
export async function ensureBusGpsTables(): Promise<void> {
  if (ensured) return;
  await prisma.$executeRawUnsafe(`
    CREATE TABLE IF NOT EXISTS bus_gps_pings (
      id            TEXT PRIMARY KEY,
      created_at    TIMESTAMPTZ DEFAULT NOW(),
      tenant_id     TEXT,
      vehicle_id    TEXT NOT NULL,
      schedule_id   TEXT,
      latitude      DOUBLE PRECISION NOT NULL,
      longitude     DOUBLE PRECISION NOT NULL,
      speed_kmh     DOUBLE PRECISION,
      heading_deg   DOUBLE PRECISION,
      accuracy_m    DOUBLE PRECISION,
      occurred_at   TIMESTAMPTZ NOT NULL,
      source        TEXT
    )
  `);
  await prisma.$executeRawUnsafe(
    `CREATE INDEX IF NOT EXISTS idx_bus_gps_pings_schedule_occurred ON bus_gps_pings (schedule_id, occurred_at)`,
  );
  await prisma.$executeRawUnsafe(
    `CREATE INDEX IF NOT EXISTS idx_bus_gps_pings_vehicle_occurred ON bus_gps_pings (vehicle_id, occurred_at)`,
  );

  await prisma.$executeRawUnsafe(`
    CREATE TABLE IF NOT EXISTS trip_stop_visits (
      id                    TEXT PRIMARY KEY,
      created_at            TIMESTAMPTZ DEFAULT NOW(),
      updated_at            TIMESTAMPTZ,
      tenant_id             TEXT,
      schedule_id           TEXT NOT NULL,
      stop_id               TEXT NOT NULL,
      approached_at         TIMESTAMPTZ,
      entered_at            TIMESTAMPTZ,
      left_at               TIMESTAMPTZ,
      approach_notified_at  TIMESTAMPTZ
    )
  `);
  await prisma.$executeRawUnsafe(
    `CREATE UNIQUE INDEX IF NOT EXISTS uniq_trip_stop_visit ON trip_stop_visits (schedule_id, stop_id)`,
  );

  await prisma.$executeRawUnsafe(
    `ALTER TABLE route_stops ADD COLUMN IF NOT EXISTS geofence_radius_m INTEGER`,
  );

  ensured = true;
}
