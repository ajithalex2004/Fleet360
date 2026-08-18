/**
 * Fleet Routing — time-window resolver.
 *
 * Walks the 3-level sourcing hierarchy to produce the effective
 * time window for a single passenger:
 *
 *   1. RoutePassenger override      (per-enrollment fine-tuning)
 *   2. BusRoute service defaults    (route-level shift window)
 *   3. Tenant defaults              (org-wide fallback)
 *   4. Compiled-in fallback         (last-resort so we never return null)
 *
 * The 3-level chain (as the design settled — no per-employee shift data
 * exists in this codebase). Effective per-passenger window derives from
 * BusRoute.departureTime ± pickupBufferMin unless overridden explicitly.
 *
 * All input times are 'HH:MM' 24h strings (matches the existing schema
 * convention). Output is ISO-8601 timestamps anchored to the given
 * targetDate so the solver has absolute instants to reason about.
 */

import type { ResolvedTimeWindow } from './types';

/** Compiled-in fallbacks — only used when every hierarchy level is null. */
const FALLBACK_PICKUP_BUFFER_MIN = 15;
const FALLBACK_REQUIRED_ARRIVAL_HHMM = '08:00';

// ── Input shapes (loose so callers don't need Prisma types here) ────────────

export interface PassengerLike {
  pickupTime?: string | null;              // 'HH:MM' — the "preferred" pickup
  earliestPickup?: string | null;          // override
  latestPickup?: string | null;            // override
  requiredArrivalTime?: string | null;     // override
  pickupBufferMin?: number | null;         // override
}

export interface RouteLike {
  departureTime?: string | null;           // 'HH:MM' — anchor for buffer math
  expectedArrivalTime?: string | null;     // 'HH:MM' — route-level required arrival
  pickupBufferMin?: number | null;
}

export interface TenantLike {
  defaultPickupBufferMin?: number | null;
  defaultRequiredArrivalTime?: string | null;
}

// ── Public API ──────────────────────────────────────────────────────────────

/**
 * Resolve the effective time window for one passenger. Provenance is
 * recorded per-field so the UI can explain "why did the solver think X
 * had to be picked up between 06:45 and 07:15?" without guessing.
 */
export function resolveTimeWindow(
  passenger: PassengerLike,
  route: RouteLike,
  tenant: TenantLike,
  targetDate: Date,   // day the window is anchored to
): ResolvedTimeWindow {
  // ── Buffer: passenger → route → tenant → fallback ─────────────────────────
  const bufferMin =
    passenger.pickupBufferMin ??
    route.pickupBufferMin ??
    tenant.defaultPickupBufferMin ??
    FALLBACK_PICKUP_BUFFER_MIN;

  // ── Earliest pickup ───────────────────────────────────────────────────────
  let earliestSource: ResolvedTimeWindow['provenance']['earliestPickup'];
  let earliestHhmm: string;
  if (passenger.earliestPickup) {
    earliestHhmm = passenger.earliestPickup;
    earliestSource = 'passenger';
  } else if (passenger.pickupTime && route.departureTime) {
    // Passenger has a preferred pickup + we have a route anchor — derive
    // (preferred - buffer) so consolidation is possible within the buffer.
    earliestHhmm = shiftHhmm(passenger.pickupTime, -bufferMin);
    earliestSource = 'passenger';
  } else if (route.departureTime) {
    earliestHhmm = shiftHhmm(route.departureTime, -bufferMin);
    earliestSource = 'route';
  } else {
    // Nothing to anchor to — go 30 min before the required-arrival fallback
    // so the solver has SOME window (better than crashing).
    earliestHhmm = shiftHhmm(FALLBACK_REQUIRED_ARRIVAL_HHMM, -90);
    earliestSource = 'fallback';
  }

  // ── Latest pickup ─────────────────────────────────────────────────────────
  let latestSource: ResolvedTimeWindow['provenance']['latestPickup'];
  let latestHhmm: string;
  if (passenger.latestPickup) {
    latestHhmm = passenger.latestPickup;
    latestSource = 'passenger';
  } else if (passenger.pickupTime) {
    latestHhmm = shiftHhmm(passenger.pickupTime, +bufferMin);
    latestSource = 'passenger';
  } else if (route.departureTime) {
    latestHhmm = shiftHhmm(route.departureTime, +bufferMin);
    latestSource = 'route';
  } else {
    latestHhmm = shiftHhmm(FALLBACK_REQUIRED_ARRIVAL_HHMM, -30);
    latestSource = 'fallback';
  }

  // ── Required arrival (HARD constraint) ────────────────────────────────────
  let arrivalSource: ResolvedTimeWindow['provenance']['requiredArrival'];
  let arrivalHhmm: string;
  if (passenger.requiredArrivalTime) {
    arrivalHhmm = passenger.requiredArrivalTime;
    arrivalSource = 'passenger';
  } else if (route.expectedArrivalTime) {
    arrivalHhmm = route.expectedArrivalTime;
    arrivalSource = 'route';
  } else if (tenant.defaultRequiredArrivalTime) {
    arrivalHhmm = tenant.defaultRequiredArrivalTime;
    arrivalSource = 'tenant';
  } else {
    arrivalHhmm = FALLBACK_REQUIRED_ARRIVAL_HHMM;
    arrivalSource = 'fallback';
  }

  return {
    earliestPickup:  hhmmToIso(earliestHhmm, targetDate),
    latestPickup:    hhmmToIso(latestHhmm, targetDate),
    requiredArrival: hhmmToIso(arrivalHhmm, targetDate),
    provenance: {
      earliestPickup:  earliestSource,
      latestPickup:    latestSource,
      requiredArrival: arrivalSource,
    },
  };
}

// ── HH:MM helpers ───────────────────────────────────────────────────────────

/**
 * Add (or subtract, when negative) `deltaMin` from an 'HH:MM' string.
 * Wraps into the next / previous day cleanly — a stop at 23:50 + 30min
 * returns '00:20', with the caller responsible for handling the day change
 * when it converts to an ISO timestamp (hhmmToIso works off the given date,
 * so wraparound at midnight is a rare edge case we treat as "same day"
 * for simplicity — real depot shifts don't span midnight typically).
 */
function shiftHhmm(hhmm: string, deltaMin: number): string {
  const [hStr, mStr] = hhmm.split(':');
  const h = Number(hStr);
  const m = Number(mStr);
  if (!Number.isFinite(h) || !Number.isFinite(m)) return hhmm; // leave malformed alone
  const total = h * 60 + m + deltaMin;
  const normalized = ((total % (24 * 60)) + 24 * 60) % (24 * 60);
  const outH = Math.floor(normalized / 60);
  const outM = normalized % 60;
  return `${String(outH).padStart(2, '0')}:${String(outM).padStart(2, '0')}`;
}

/**
 * Convert 'HH:MM' + a target date (local calendar) into an ISO-8601 UTC
 * timestamp. The wall clock is interpreted as the SERVER's local timezone
 * — see the note in the run scheduler about tenant-timezone handling.
 * For UAE deployment the server is expected to run in Asia/Dubai (UTC+04).
 */
function hhmmToIso(hhmm: string, targetDate: Date): string {
  const [hStr, mStr] = hhmm.split(':');
  const h = Number(hStr);
  const m = Number(mStr);
  const d = new Date(targetDate);
  d.setHours(Number.isFinite(h) ? h : 0, Number.isFinite(m) ? m : 0, 0, 0);
  return d.toISOString();
}
