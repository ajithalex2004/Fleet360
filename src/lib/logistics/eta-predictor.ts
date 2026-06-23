/**
 * ETA predictor — continuously estimates a shipment's arrival time from its
 * GPS tracking history.
 *
 * Gap #3 from the logistics competitive analysis: static planned-duration
 * ETAs are the customer-experience equivalent of FedEx in 2005. This module
 * produces a *dynamic* ETA that updates as the truck moves, so the customer
 * sees "arriving 16:40" shift to "arriving 17:15" the moment the truck hits
 * traffic — and (Phase 2) gets notified when it does.
 *
 * v1 method (this file): observed-speed extrapolation, NOT a trained ML
 * model. The analysis explicitly says "start with regression on tracking
 * history, add a model in v2." Observed-speed is the pragmatic regression:
 *   effective speed = distance travelled across recent pings / time elapsed
 *   remaining time  = remaining road distance / effective speed
 *   ETA             = now + remaining time
 *
 * Fallback ladder when GPS is thin or the truck is stopped:
 *   observed-speed → lane historical average → configured default speed →
 *   planned arrival time. Every prediction reports which method it used and
 *   a confidence level, so the UI and notifier can treat a low-confidence
 *   ETA differently from a high-confidence one.
 *
 * Pure module: no DB, no network. The service layer (Phase 2) loads tracking
 * history and persists the result. Keeping the math pure makes the dozens of
 * edge cases (stopped truck, GPS jitter, out-of-order pings, already-arrived)
 * unit-testable without a database.
 */

import { haversineKm, type LatLng } from './distance-matrix';

// ── Inputs ───────────────────────────────────────────────────────────────────

export interface TrackingPoint {
  latitude: number;
  longitude: number;
  /** ISO timestamp the ping was recorded. */
  occurredAt: string;
}

export interface PredictEtaInput {
  /** Recent GPS pings. Order doesn't matter — we sort by occurredAt. */
  trackingPoints: TrackingPoint[];
  /** Where the shipment is going. Null when we don't have coordinates. */
  destination: LatLng | null;
  /** ISO "now" — passed in for deterministic testing. */
  now: string;
  /** Planned arrival (delivery window) — the ultimate fallback. */
  plannedArrivalAt?: string | null;
  /** Historical average speed for this lane, km/h (fallback when GPS is thin). */
  laneAverageSpeedKmh?: number | null;
  config?: EtaConfig;
}

export interface EtaConfig {
  /** Crow-flies → road distance multiplier. GCC default 1.3. */
  detourFactor?: number;
  /** Used when we have no observed speed and no lane average. km/h. */
  defaultSpeedKmh?: number;
  /** Below this observed speed we treat the truck as "temporarily stopped"
   *  (rest stop, loading, traffic jam) and DON'T extrapolate to infinity —
   *  we fall back to lane/default speed for the remaining-time estimate. */
  stoppedSpeedFloorKmh?: number;
  /** Above this, an observed speed is implausible (GPS jump) and rejected. */
  maxPlausibleSpeedKmh?: number;
  /** Within this distance of the destination, the shipment is "arrived". km. */
  arrivalRadiusKm?: number;
  /** Minimum seconds between the two pings used for a speed reading. Guards
   *  against dividing by a near-zero interval. */
  minSpeedWindowSec?: number;
  /** How many of the most-recent pings to use for the observed-speed reading. */
  speedWindowPoints?: number;
}

const DEFAULTS: Required<EtaConfig> = {
  detourFactor: 1.3,
  defaultSpeedKmh: 60,
  stoppedSpeedFloorKmh: 5,
  maxPlausibleSpeedKmh: 140,
  arrivalRadiusKm: 0.5,
  minSpeedWindowSec: 60,
  speedWindowPoints: 5,
};

// ── Output ───────────────────────────────────────────────────────────────────

export type EtaMethod =
  | 'observed-speed'   // extrapolated from how fast the truck is actually moving
  | 'lane-average'     // truck stopped or GPS thin → historical lane speed
  | 'default-speed'    // no lane history either → configured default
  | 'planned'          // no usable GPS or destination → fall back to the plan
  | 'arrived';         // already within the arrival radius

export type EtaConfidence = 'high' | 'medium' | 'low';

export interface EtaPrediction {
  /** ISO predicted arrival, or null if we couldn't estimate at all. */
  etaAt: string | null;
  method: EtaMethod;
  confidence: EtaConfidence;
  remainingKm: number | null;
  effectiveSpeedKmh: number | null;
  /** Human-readable explanation for audit / debugging. */
  reason: string;
}

// ── Helpers ──────────────────────────────────────────────────────────────────

function ms(iso: string): number {
  return new Date(iso).getTime();
}

function addHoursIso(baseIso: string, hours: number): string {
  return new Date(ms(baseIso) + hours * 3_600_000).toISOString();
}

function round2(n: number): number { return Math.round(n * 100) / 100; }

/**
 * Observed speed (km/h) across the most recent window of pings.
 * Returns null when there aren't enough points or the time window is too short.
 *
 * Sums leg-by-leg distance (not just first→last straight line) so a truck that
 * curves along a road isn't under-counted, then divides by the total elapsed
 * time. This is the "regression on tracking history" the analysis called for,
 * in its simplest honest form.
 */
export function observedSpeedKmh(points: TrackingPoint[], cfg: Required<EtaConfig>): number | null {
  if (points.length < 2) return null;
  const sorted = [...points].sort((a, b) => ms(a.occurredAt) - ms(b.occurredAt));
  const window = sorted.slice(-cfg.speedWindowPoints);
  if (window.length < 2) return null;

  let distKm = 0;
  for (let i = 1; i < window.length; i++) {
    distKm += haversineKm(window[i - 1], window[i]);
  }
  const elapsedSec = (ms(window[window.length - 1].occurredAt) - ms(window[0].occurredAt)) / 1000;
  if (elapsedSec < cfg.minSpeedWindowSec) return null;

  const speed = distKm / (elapsedSec / 3600);
  if (!Number.isFinite(speed) || speed < 0) return null;
  return speed;
}

function latestPoint(points: TrackingPoint[]): TrackingPoint | null {
  if (!points.length) return null;
  return [...points].sort((a, b) => ms(a.occurredAt) - ms(b.occurredAt))[points.length - 1];
}

// ── Main entry point ─────────────────────────────────────────────────────────

export function predictEta(input: PredictEtaInput): EtaPrediction {
  const cfg: Required<EtaConfig> = { ...DEFAULTS, ...(input.config ?? {}) };
  const { trackingPoints, destination, now, plannedArrivalAt, laneAverageSpeedKmh } = input;

  const planned = (reason: string): EtaPrediction => ({
    etaAt: plannedArrivalAt ?? null,
    method: 'planned',
    confidence: 'low',
    remainingKm: null,
    effectiveSpeedKmh: null,
    reason,
  });

  // No destination coordinates → nothing to extrapolate toward.
  if (!destination) return planned('No destination coordinates; using planned arrival.');

  const current = latestPoint(trackingPoints.filter(p => p.latitude != null && p.longitude != null));
  if (!current) return planned('No GPS pings with coordinates; using planned arrival.');

  // Remaining road distance ≈ crow-flies × detour factor.
  const crowKm = haversineKm(current, destination);
  const remainingKm = round2(crowKm * cfg.detourFactor);

  // Already there?
  if (crowKm <= cfg.arrivalRadiusKm) {
    return {
      etaAt: now,
      method: 'arrived',
      confidence: 'high',
      remainingKm,
      effectiveSpeedKmh: null,
      reason: `Within ${cfg.arrivalRadiusKm}km of destination — treated as arrived.`,
    };
  }

  // Pick an effective speed via the fallback ladder.
  const observed = observedSpeedKmh(trackingPoints, cfg);
  let speed: number;
  let method: EtaMethod;
  let confidence: EtaConfidence;
  let reason: string;

  if (observed != null && observed >= cfg.stoppedSpeedFloorKmh && observed <= cfg.maxPlausibleSpeedKmh) {
    speed = observed;
    method = 'observed-speed';
    confidence = 'high';
    reason = `Observed ${round2(observed)}km/h from recent pings.`;
  } else if (laneAverageSpeedKmh != null && laneAverageSpeedKmh > 0) {
    speed = laneAverageSpeedKmh;
    method = 'lane-average';
    confidence = 'medium';
    reason = observed != null && observed < cfg.stoppedSpeedFloorKmh
      ? `Truck appears stopped (${round2(observed)}km/h); using lane average ${laneAverageSpeedKmh}km/h.`
      : `Insufficient/implausible GPS speed; using lane average ${laneAverageSpeedKmh}km/h.`;
  } else {
    speed = cfg.defaultSpeedKmh;
    method = 'default-speed';
    confidence = 'low';
    reason = `No observed speed or lane average; using default ${cfg.defaultSpeedKmh}km/h.`;
  }

  const remainingHours = remainingKm / speed;
  const etaAt = addHoursIso(now, remainingHours);

  return {
    etaAt,
    method,
    confidence,
    remainingKm,
    effectiveSpeedKmh: round2(speed),
    reason,
  };
}

/**
 * Convenience: minutes of difference between two ISO timestamps (b − a).
 * Used by the notifier to decide whether an ETA shift is "material".
 */
export function etaDeltaMinutes(aIso: string | null, bIso: string | null): number | null {
  if (!aIso || !bIso) return null;
  return Math.round((ms(bIso) - ms(aIso)) / 60_000);
}
