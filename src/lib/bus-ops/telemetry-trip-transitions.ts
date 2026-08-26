/**
 * Telemetry-driven trip Start / Complete with geofence drift handling.
 *
 * Rollout modes (env TELEMETRY_TRIP_MODE):
 *   shadow  — evaluate + log only (default)
 *   live    — evaluate + apply status transitions
 *   off     — skip evaluation
 *
 * Drift / GPS noise controls:
 *   1. Accuracy gate  — drop pings with accuracy_m above MAX_ACCURACY_M
 *   2. Jump gate      — ignore teleports (distance/time above MAX_JUMP_*)
 *   3. Hysteresis     — exit radius > enter radius so fence edges don't flicker
 *   4. Dwell window   — require sustained samples over START/COMPLETE_DWELL_MS
 *                       using recent bus_gps_pings history (serverless-safe)
 *   5. Origin exit    — START needs prior "inside origin" then sustained outside
 *
 * Human / API transitions via /depart and /complete always win.
 */

import type { PrismaClient } from '@prisma/client';
import { haversineM, DEFAULT_ARRIVAL_RADIUS_M } from '@/lib/bus-gps';
import {
  assertTripTransition,
  normalizeTripStatus,
  type TripScheduleStatus,
} from '@/lib/bus-ops/state-machines';

// ── Thresholds (env overrides; formulas below when env unset) ───────

export const START_SPEED_KMH = numEnv('TELEMETRY_START_SPEED_KMH', 8);
export const COMPLETE_SPEED_KMH = numEnv('TELEMETRY_COMPLETE_SPEED_KMH', 3);
export const START_WINDOW_MIN = numEnv('TELEMETRY_START_WINDOW_MIN', 60);

/**
 * Static fallback hysteresis (metres). Prefer computeHysteresisM().
 * Env TELEMETRY_HYSTERESIS_M forces a fixed band and skips the formula.
 */
export const HYSTERESIS_M = numEnv('TELEMETRY_HYSTERESIS_M', 30);

export const MAX_ACCURACY_M = numEnv('TELEMETRY_MAX_ACCURACY_M', 45);
export const MAX_JUMP_M = numEnv('TELEMETRY_MAX_JUMP_M', 500);
export const MAX_JUMP_GAP_S = numEnv('TELEMETRY_MAX_JUMP_GAP_S', 30);

/** Fallback dwells when formula inputs missing; env forces fixed values. */
export const START_DWELL_MS = numEnv('TELEMETRY_START_DWELL_MS', 35_000);
export const COMPLETE_DWELL_MS = numEnv('TELEMETRY_COMPLETE_DWELL_MS', 150_000);
export const HISTORY_LOOKBACK_MS = numEnv('TELEMETRY_HISTORY_LOOKBACK_MS', 300_000);

/** Assumed GPS report interval when deriving dwell (ms). */
export const ASSUMED_PING_INTERVAL_MS = numEnv('TELEMETRY_PING_INTERVAL_MS', 10_000);

export const TELEMETRY_SOURCE = 'TELEMETRY';

// Formula coefficients (tuned for staff-bus UAE depots + typical phone/tracker GPS)
const H_ALPHA = 1.0;          // weight on GPS accuracy σ
const H_BETA = 0.22;          // weight on enter radius R
const H_FLOOR_M = 15;
const H_CAP_M = 60;
const DEFAULT_SIGMA_M = 18;    // when accuracy unknown

const START_DWELL_FLOOR_MS = 20_000;
const START_DWELL_CAP_MS = 90_000;
const START_CONFIRM_PINGS = 2;

const COMPLETE_DWELL_FLOOR_MS = 90_000;
const COMPLETE_DWELL_CAP_MS = 300_000;
const COMPLETE_ALIGHT_BUFFER_MS = 60_000; // passengers / door time

function numEnv(key: string, fallback: number): number {
  const v = process.env[key];
  if (v == null || v.trim() === '') return fallback;
  const n = Number(v);
  return Number.isFinite(n) ? n : fallback;
}

function envIsSet(key: string): boolean {
  const v = process.env[key];
  return v != null && String(v).trim() !== '';
}

function clamp(n: number, lo: number, hi: number): number {
  return Math.min(hi, Math.max(lo, n));
}

/**
 * Hysteresis band H (metres):
 *
 *   H = clamp( max(H_FLOOR, α·σ + β·R_enter), H_FLOOR, H_CAP )
 *
 *   σ = GPS accuracy (m), or DEFAULT_SIGMA_M if unknown
 *   R_enter = stop enter radius (m)
 *   α = 1.0, β = 0.22, floor 15 m, cap 60 m
 *
 * If TELEMETRY_HYSTERESIS_M is set, that fixed value is used instead.
 */
export function computeHysteresisM(opts: {
  enterRadiusM: number;
  accuracyM?: number | null;
}): number {
  if (envIsSet('TELEMETRY_HYSTERESIS_M')) return HYSTERESIS_M;
  const sigma =
    opts.accuracyM != null && Number.isFinite(opts.accuracyM) && opts.accuracyM > 0
      ? opts.accuracyM
      : DEFAULT_SIGMA_M;
  const R = Math.max(0, opts.enterRadiusM);
  const raw = Math.max(H_FLOOR_M, H_ALPHA * sigma + H_BETA * R);
  return clamp(raw, H_FLOOR_M, H_CAP_M);
}

/**
 * Start dwell (ms) — time the bus must stay *outside exit radius* while moving:
 *
 *   v = startSpeedKmh · (1000/3600)     // m/s
 *   t_cross = H / max(v, 0.5)          // time to clear hysteresis band
 *   T_start = clamp(
 *               max(FLOOR, t_cross·1000 + N_confirm · T_ping),
 *               FLOOR, CAP
 *             )
 *
 * FLOOR=20s, CAP=90s, N_confirm=2, T_ping=ASSUMED_PING_INTERVAL_MS
 * Env TELEMETRY_START_DWELL_MS forces a fixed dwell.
 */
export function computeStartDwellMs(opts: {
  hysteresisM: number;
  startSpeedKmh?: number;
}): number {
  if (envIsSet('TELEMETRY_START_DWELL_MS')) return START_DWELL_MS;
  const v = Math.max(0.5, ((opts.startSpeedKmh ?? START_SPEED_KMH) * 1000) / 3600);
  const tCrossMs = (opts.hysteresisM / v) * 1000;
  const raw = Math.max(
    START_DWELL_FLOOR_MS,
    tCrossMs + START_CONFIRM_PINGS * ASSUMED_PING_INTERVAL_MS,
  );
  return clamp(raw, START_DWELL_FLOOR_MS, START_DWELL_CAP_MS);
}

/**
 * Complete dwell (ms) — sustained *inside enter radius* at low speed:
 *
 *   v_crawl = max(completeSpeedKmh, 1 km/h) in m/s
 *   t_settle = R_enter / v_crawl        // settle across fence depth
 *   T_complete = clamp(
 *                  max(FLOOR, t_settle·1000 + T_alight),
 *                  FLOOR, CAP
 *                )
 *
 * T_alight=60s, FLOOR=90s, CAP=300s
 * Env TELEMETRY_COMPLETE_DWELL_MS forces a fixed dwell.
 */
export function computeCompleteDwellMs(opts: {
  enterRadiusM: number;
  completeSpeedKmh?: number;
}): number {
  if (envIsSet('TELEMETRY_COMPLETE_DWELL_MS')) return COMPLETE_DWELL_MS;
  const kmh = Math.max(1, opts.completeSpeedKmh ?? COMPLETE_SPEED_KMH);
  const v = (kmh * 1000) / 3600;
  const tSettleMs = (Math.max(0, opts.enterRadiusM) / v) * 1000;
  const raw = Math.max(COMPLETE_DWELL_FLOOR_MS, tSettleMs + COMPLETE_ALIGHT_BUFFER_MS);
  return clamp(raw, COMPLETE_DWELL_FLOOR_MS, COMPLETE_DWELL_CAP_MS);
}

/** Bundle used by the decision path (and shadow evidence). */
export function computeGeofenceTuning(opts: {
  originEnterRadiusM: number;
  destEnterRadiusM: number;
  accuracyM?: number | null;
}): {
  hysteresisM: number;
  startDwellMs: number;
  completeDwellMs: number;
  formulas: Record<string, string>;
} {
  const hysteresisM = computeHysteresisM({
    enterRadiusM: opts.originEnterRadiusM,
    accuracyM: opts.accuracyM,
  });
  const startDwellMs = computeStartDwellMs({ hysteresisM });
  const completeDwellMs = computeCompleteDwellMs({
    enterRadiusM: opts.destEnterRadiusM,
  });
  return {
    hysteresisM,
    startDwellMs,
    completeDwellMs,
    formulas: {
      hysteresis:
        'H = clamp(max(15, 1.0·σ + 0.22·R_enter), 15, 60)  [or TELEMETRY_HYSTERESIS_M]',
      startDwell:
        'T_start = clamp(max(20s, H/v_start + 2·T_ping), 20s, 90s)  [or TELEMETRY_START_DWELL_MS]',
      completeDwell:
        'T_complete = clamp(max(90s, R_enter/v_crawl + 60s), 90s, 300s)  [or TELEMETRY_COMPLETE_DWELL_MS]',
    },
  };
}

export type TelemetryMode = 'shadow' | 'live' | 'off';

export type TelemetryPing = {
  tenantId: string;
  vehicleId: string;
  latitude: number;
  longitude: number;
  speedKmh?: number | null;
  ignitionOn?: boolean | null;
  accuracyM?: number | null;
  occurredAt?: Date;
  scheduleId?: string | null;
};

export type TelemetryDecision =
  | { action: 'NONE'; reason: string; evidence?: Record<string, unknown> }
  | {
      action: 'STARTED' | 'EN_ROUTE' | 'COMPLETED';
      scheduleId: string;
      from: TripScheduleStatus;
      to: TripScheduleStatus;
      reason: string;
      evidence: Record<string, unknown>;
    };

export type TelemetryResult = TelemetryDecision & {
  mode: TelemetryMode;
  applied: boolean;
};

export function resolveTelemetryMode(
  env: NodeJS.ProcessEnv = process.env,
): TelemetryMode {
  const mode = (env.TELEMETRY_TRIP_MODE ?? '').trim().toLowerCase();
  if (mode === 'live' || mode === 'off' || mode === 'shadow') return mode;
  const shadow = (env.TELEMETRY_TRIP_SHADOW ?? 'true').trim().toLowerCase();
  if (shadow === '0' || shadow === 'false' || shadow === 'no') return 'live';
  if (shadow === 'off') return 'off';
  return 'shadow';
}

// ── Geometry helpers ────────────────────────────────────────────────

type StopGeo = {
  gpsLat: number | null;
  gpsLng: number | null;
  geofenceRadiusM?: number | null;
};

function enterRadiusM(stop: StopGeo): number {
  return stop.geofenceRadiusM ?? DEFAULT_ARRIVAL_RADIUS_M;
}

/** Outside test uses a larger radius so brief GPS spikes don't re-enter. */
function exitRadiusM(stop: StopGeo, hysteresisM: number = HYSTERESIS_M): number {
  return enterRadiusM(stop) + hysteresisM;
}

function distanceToStopM(
  lat: number,
  lng: number,
  stop: StopGeo,
): number | null {
  if (stop.gpsLat == null || stop.gpsLng == null) return null;
  return haversineM(
    { latitude: lat, longitude: lng },
    { latitude: stop.gpsLat, longitude: stop.gpsLng },
  );
}

export function isInsideEnter(lat: number, lng: number, stop: StopGeo): boolean | null {
  const d = distanceToStopM(lat, lng, stop);
  if (d == null) return null;
  return d <= enterRadiusM(stop);
}

/** Outside only when beyond exit radius (hysteresis). */
export function isOutsideExit(
  lat: number,
  lng: number,
  stop: StopGeo,
  hysteresisM: number = HYSTERESIS_M,
): boolean | null {
  const d = distanceToStopM(lat, lng, stop);
  if (d == null) return null;
  return d > exitRadiusM(stop, hysteresisM);
}

// ── History sample ──────────────────────────────────────────────────

export type GpsSample = {
  latitude: number;
  longitude: number;
  speedKmh: number | null;
  accuracyM: number | null;
  occurredAt: Date;
};

/**
 * Filter one sample for drift. Returns null if the sample should be ignored.
 */
export function sanitizeSample(
  sample: GpsSample,
  prev: GpsSample | null,
): { ok: true; sample: GpsSample } | { ok: false; reason: string } {
  if (
    !Number.isFinite(sample.latitude) ||
    !Number.isFinite(sample.longitude) ||
    Math.abs(sample.latitude) > 90 ||
    Math.abs(sample.longitude) > 180
  ) {
    return { ok: false, reason: 'invalid coordinates' };
  }

  if (
    MAX_ACCURACY_M > 0 &&
    sample.accuracyM != null &&
    sample.accuracyM > MAX_ACCURACY_M
  ) {
    return {
      ok: false,
      reason: `accuracy ${sample.accuracyM}m > ${MAX_ACCURACY_M}m`,
    };
  }

  if (prev) {
    const gapS =
      Math.abs(sample.occurredAt.getTime() - prev.occurredAt.getTime()) / 1000;
    if (gapS > 0 && gapS <= MAX_JUMP_GAP_S) {
      const jump = haversineM(
        { latitude: sample.latitude, longitude: sample.longitude },
        { latitude: prev.latitude, longitude: prev.longitude },
      );
      // Allow roughly 120 km/h + margin; also hard cap MAX_JUMP_M
      const maxBySpeed = (120_000 / 3600) * gapS * 1.5; // m
      const limit = Math.max(MAX_JUMP_M, maxBySpeed);
      if (jump > limit) {
        return {
          ok: false,
          reason: `jump ${Math.round(jump)}m in ${gapS.toFixed(1)}s exceeds ${Math.round(limit)}m`,
        };
      }
    }
  }

  return { ok: true, sample };
}

/**
 * True when the last `dwellMs` of the timeline is continuously covered by
 * samples that each pass `predicate`, with no gap larger than dwellMs/2
 * between consecutive accepted samples (avoids sparse GPS faking dwell).
 */
export function sustainedFor(
  samples: GpsSample[],
  dwellMs: number,
  now: Date,
  predicate: (s: GpsSample) => boolean,
): { ok: boolean; matchedMs: number; matchedCount: number } {
  const windowStart = now.getTime() - dwellMs;
  const inWindow = samples
    .filter((s) => s.occurredAt.getTime() >= windowStart && s.occurredAt.getTime() <= now.getTime())
    .sort((a, b) => a.occurredAt.getTime() - b.occurredAt.getTime());

  if (inWindow.length === 0) {
    return { ok: false, matchedMs: 0, matchedCount: 0 };
  }

  const maxGap = Math.max(dwellMs / 2, 15_000);
  let chain: GpsSample[] = [];
  for (const s of inWindow) {
    if (!predicate(s)) {
      chain = [];
      continue;
    }
    if (chain.length === 0) {
      chain = [s];
      continue;
    }
    const gap =
      s.occurredAt.getTime() - chain[chain.length - 1].occurredAt.getTime();
    if (gap > maxGap) {
      chain = [s];
      continue;
    }
    chain.push(s);
  }

  if (chain.length === 0) {
    return { ok: false, matchedMs: 0, matchedCount: 0 };
  }

  const matchedMs =
    chain[chain.length - 1].occurredAt.getTime() - chain[0].occurredAt.getTime();
  // Single dense sample near "now" after a long trip is not enough — need span
  // or at least 2 samples covering dwell when history is thin
  const ok =
    matchedMs >= dwellMs ||
    (chain.length >= 3 && matchedMs >= dwellMs * 0.6);

  return { ok, matchedMs, matchedCount: chain.length };
}

/**
 * Origin exit for START: some sample in lookback was inside enter-radius,
 * and the sustained recent window is outside exit-radius.
 */
export function originExitSustained(
  samples: GpsSample[],
  origin: StopGeo,
  now: Date,
  dwellMs: number,
  hysteresisM: number = HYSTERESIS_M,
): { ok: boolean; sawInside: boolean; outside: ReturnType<typeof sustainedFor> } {
  const sawInside = samples.some((s) => isInsideEnter(s.latitude, s.longitude, origin) === true);
  const outside = sustainedFor(
    samples,
    dwellMs,
    now,
    (s) => {
      const out = isOutsideExit(s.latitude, s.longitude, origin, hysteresisM);
      const speed = s.speedKmh ?? 0;
      return out === true && speed >= START_SPEED_KMH;
    },
  );
  return { ok: sawInside && outside.ok, sawInside, outside };
}

export function destinationDwellSustained(
  samples: GpsSample[],
  destination: StopGeo,
  now: Date,
  dwellMs: number,
): ReturnType<typeof sustainedFor> {
  return sustainedFor(samples, dwellMs, now, (s) => {
    const inside = isInsideEnter(s.latitude, s.longitude, destination);
    const speed = s.speedKmh ?? 0;
    return inside === true && speed <= COMPLETE_SPEED_KMH;
  });
}

// ── Schedule load + history ─────────────────────────────────────────

type ScheduleWithStops = {
  id: string;
  // Both loaders use `include`, so every scalar comes back at runtime — this
  // hand-written shape just never listed it. applyDecision needs it to stamp
  // trip_logs.tenant_id, which is NOT NULL as of 20260910000000.
  tenantId: string;
  status: string | null;
  vehicleId: string | null;
  departureTime: Date | null;
  route: {
    stops: Array<{
      id: string;
      sequence: number;
      gpsLat: number | null;
      gpsLng: number | null;
      geofenceRadiusM: number | null;
      stopName: string | null;
    }>;
  } | null;
};

async function loadSchedule(
  db: PrismaClient,
  ping: TelemetryPing,
  now: Date,
): Promise<ScheduleWithStops | null> {
  const stopSelect = {
    id: true,
    sequence: true,
    gpsLat: true,
    gpsLng: true,
    geofenceRadiusM: true,
    stopName: true,
  } as const;

  const include = {
    route: {
      include: {
        stops: { orderBy: { sequence: 'asc' as const }, select: stopSelect },
      },
    },
  };

  if (ping.scheduleId) {
    return db.tripSchedule.findFirst({
      where: {
        id: ping.scheduleId,
        tenantId: ping.tenantId,
        deletedAt: null,
      },
      include,
    }) as Promise<ScheduleWithStops | null>;
  }

  const dayStart = new Date(now);
  dayStart.setHours(0, 0, 0, 0);
  const dayEnd = new Date(dayStart);
  dayEnd.setDate(dayEnd.getDate() + 1);

  return db.tripSchedule.findFirst({
    where: {
      tenantId: ping.tenantId,
      vehicleId: ping.vehicleId,
      deletedAt: null,
      departureTime: { gte: dayStart, lt: dayEnd },
      status: { in: ['SCHEDULED', 'STARTED', 'EN_ROUTE', 'DEPARTED', 'IN_TRANSIT'] },
    },
    orderBy: { departureTime: 'asc' },
    include,
  }) as Promise<ScheduleWithStops | null>;
}

async function loadRecentSamples(
  db: PrismaClient,
  ping: TelemetryPing,
  scheduleId: string,
  now: Date,
): Promise<GpsSample[]> {
  const since = new Date(now.getTime() - HISTORY_LOOKBACK_MS);
  type Row = {
    latitude: number;
    longitude: number;
    speed_kmh: number | null;
    accuracy_m: number | null;
    occurred_at: Date;
  };

  let rows: Row[] = [];
  try {
    rows = await db.$queryRawUnsafe<Row[]>(
      `SELECT latitude, longitude, speed_kmh, accuracy_m, occurred_at
         FROM fleet.bus_gps_pings
        WHERE tenant_id = $1
          AND vehicle_id = $2
          AND (schedule_id = $3 OR schedule_id IS NULL)
          AND occurred_at >= $4
        ORDER BY occurred_at ASC
        LIMIT 200`,
      ping.tenantId,
      ping.vehicleId,
      scheduleId,
      since,
    );
  } catch {
    // Table/schema may differ in some envs — fall back to current ping only
    rows = [];
  }

  const samples: GpsSample[] = [];
  let prev: GpsSample | null = null;
  for (const r of rows) {
    const candidate: GpsSample = {
      latitude: Number(r.latitude),
      longitude: Number(r.longitude),
      speedKmh: r.speed_kmh != null ? Number(r.speed_kmh) : null,
      accuracyM: r.accuracy_m != null ? Number(r.accuracy_m) : null,
      occurredAt: new Date(r.occurred_at),
    };
    const sanitized = sanitizeSample(candidate, prev);
    if (!sanitized.ok) continue;
    samples.push(sanitized.sample);
    prev = sanitized.sample;
  }

  // Ensure current ping is included (may not be committed yet in same txn)
  const current: GpsSample = {
    latitude: ping.latitude,
    longitude: ping.longitude,
    speedKmh: ping.speedKmh ?? null,
    accuracyM: ping.accuracyM ?? null,
    occurredAt: ping.occurredAt ?? now,
  };
  const cur = sanitizeSample(current, prev);
  if (cur.ok) {
    const last = samples[samples.length - 1];
    if (
      !last ||
      last.occurredAt.getTime() !== cur.sample.occurredAt.getTime() ||
      last.latitude !== cur.sample.latitude ||
      last.longitude !== cur.sample.longitude
    ) {
      samples.push(cur.sample);
    }
  }

  return samples;
}

// ── Decision ────────────────────────────────────────────────────────

/**
 * Decide transition using current ping + recent GPS history for dwell.
 */
export function decideTelemetryTransition(
  schedule: ScheduleWithStops,
  ping: TelemetryPing,
  samples: GpsSample[],
  now: Date = ping.occurredAt ?? new Date(),
): TelemetryDecision {
  const speed = ping.speedKmh ?? 0;
  const status = normalizeTripStatus(schedule.status);

  if (schedule.vehicleId && schedule.vehicleId !== ping.vehicleId) {
    return { action: 'NONE', reason: 'gps vehicle does not match schedule.vehicleId' };
  }

  const stops = schedule.route?.stops ?? [];
  if (stops.length < 1) {
    return { action: 'NONE', reason: 'route has no geocoded stops' };
  }

  const origin = stops[0];
  const destination = stops[stops.length - 1];
  const originEnter = enterRadiusM(origin);
  const destEnter = enterRadiusM(destination);
  const tuning = computeGeofenceTuning({
    originEnterRadiusM: originEnter,
    destEnterRadiusM: destEnter,
    accuracyM: ping.accuracyM,
  });
  const originDist = distanceToStopM(ping.latitude, ping.longitude, origin);
  const destDist = distanceToStopM(ping.latitude, ping.longitude, destination);

  const evidenceBase: Record<string, unknown> = {
    scheduleId: schedule.id,
    vehicleId: ping.vehicleId,
    speedKmh: speed,
    ignitionOn: ping.ignitionOn ?? null,
    accuracyM: ping.accuracyM ?? null,
    lat: ping.latitude,
    lng: ping.longitude,
    status,
    originDistanceM: originDist,
    originEnterRadiusM: originEnter,
    originExitRadiusM: originEnter + tuning.hysteresisM,
    destDistanceM: destDist,
    destEnterRadiusM: destEnter,
    hysteresisM: tuning.hysteresisM,
    startDwellRequiredMs: tuning.startDwellMs,
    completeDwellRequiredMs: tuning.completeDwellMs,
    formulas: tuning.formulas,
    sampleCount: samples.length,
  };

  // Current ping drift gate
  const self = sanitizeSample(
    {
      latitude: ping.latitude,
      longitude: ping.longitude,
      speedKmh: ping.speedKmh ?? null,
      accuracyM: ping.accuracyM ?? null,
      occurredAt: now,
    },
    samples.length >= 2 ? samples[samples.length - 2] : null,
  );
  if (!self.ok) {
    return { action: 'NONE', reason: `ping rejected: ${self.reason}`, evidence: evidenceBase };
  }

  // ── COMPLETE (dwell inside destination) ───────────────────────────
  if (status === 'STARTED' || status === 'EN_ROUTE') {
    const dwell = destinationDwellSustained(
      samples,
      destination,
      now,
      tuning.completeDwellMs,
    );
    evidenceBase.completeDwellMs = dwell.matchedMs;
    evidenceBase.completeDwellCount = dwell.matchedCount;

    if (dwell.ok) {
      try {
        assertTripTransition(status, 'COMPLETED');
        return {
          action: 'COMPLETED',
          scheduleId: schedule.id,
          from: status,
          to: 'COMPLETED',
          reason: `destination dwell ${Math.round(dwell.matchedMs / 1000)}s inside geofence, speed≤${COMPLETE_SPEED_KMH}`,
          evidence: evidenceBase,
        };
      } catch (e) {
        return {
          action: 'NONE',
          reason: `complete blocked: ${e instanceof Error ? e.message : String(e)}`,
          evidence: evidenceBase,
        };
      }
    }
  }

  // ── START (saw inside origin, then sustained outside + speed) ─────
  if (status === 'SCHEDULED') {
    const dep = schedule.departureTime ? new Date(schedule.departureTime) : null;
    if (dep) {
      const deltaMin = Math.abs(now.getTime() - dep.getTime()) / 60000;
      if (deltaMin > START_WINDOW_MIN) {
        return {
          action: 'NONE',
          reason: `outside ±${START_WINDOW_MIN}m start window`,
          evidence: evidenceBase,
        };
      }
    }

    const ignitionOk =
      ping.ignitionOn === undefined || ping.ignitionOn === null
        ? true
        : ping.ignitionOn === true;

    const exit = originExitSustained(
      samples,
      origin,
      now,
      tuning.startDwellMs,
      tuning.hysteresisM,
    );
    evidenceBase.sawInsideOrigin = exit.sawInside;
    evidenceBase.startDwellMs = exit.outside.matchedMs;
    evidenceBase.startDwellCount = exit.outside.matchedCount;

    if (exit.ok && ignitionOk) {
      try {
        assertTripTransition('SCHEDULED', 'STARTED');
        return {
          action: 'STARTED',
          scheduleId: schedule.id,
          from: 'SCHEDULED',
          to: 'STARTED',
          reason: `origin exit dwell ${Math.round(exit.outside.matchedMs / 1000)}s, speed≥${START_SPEED_KMH}, ignition=${String(ping.ignitionOn)}`,
          evidence: evidenceBase,
        };
      } catch (e) {
        return {
          action: 'NONE',
          reason: `start blocked: ${e instanceof Error ? e.message : String(e)}`,
          evidence: evidenceBase,
        };
      }
    }

    if (!exit.sawInside) {
      return {
        action: 'NONE',
        reason: 'no prior inside-origin sample (need enter before exit)',
        evidence: evidenceBase,
      };
    }
  }

  // ── EN_ROUTE soft upgrade (outside origin + moving, short dwell) ──
  if (status === 'STARTED') {
    const brief = sustainedFor(
      samples,
      Math.min(tuning.startDwellMs, 15_000),
      now,
      (s) =>
        isOutsideExit(s.latitude, s.longitude, origin, tuning.hysteresisM) === true &&
        (s.speedKmh ?? 0) >= START_SPEED_KMH,
    );
    if (brief.ok) {
      try {
        assertTripTransition('STARTED', 'EN_ROUTE');
        return {
          action: 'EN_ROUTE',
          scheduleId: schedule.id,
          from: 'STARTED',
          to: 'EN_ROUTE',
          reason: `moving outside origin, speed≥${START_SPEED_KMH}`,
          evidence: evidenceBase,
        };
      } catch (e) {
        return {
          action: 'NONE',
          reason: `en-route blocked: ${e instanceof Error ? e.message : String(e)}`,
          evidence: evidenceBase,
        };
      }
    }
  }

  return { action: 'NONE', reason: 'no rule matched', evidence: evidenceBase };
}

async function applyDecision(
  db: PrismaClient,
  decision: Extract<TelemetryDecision, { action: 'STARTED' | 'EN_ROUTE' | 'COMPLETED' }>,
  now: Date,
  // trip_logs.tenant_id is NOT NULL as of 20260910000000. Taken from the
  // schedule the decision was made against rather than resolved again here, so
  // the log cannot be attributed to a different tenant than the trip.
  tenantId: string,
): Promise<void> {
  const { scheduleId, to, action, reason } = decision;

  await db.tripSchedule.update({
    where: { id: scheduleId },
    data: { status: to, updatedAt: now },
  });

  if (action === 'STARTED') {
    await db.tripLog
      .create({
        data: {
          tenantId,
          scheduleId,
          actualDepartureTime: now,
          driverNotes: `Auto-started by telemetry (${TELEMETRY_SOURCE}): ${reason}`,
          loggedBy: TELEMETRY_SOURCE,
        },
      })
      .catch(() => undefined);
    await db.tripPassenger
      .updateMany({
        where: { tripId: scheduleId, status: 'CONFIRMED', deletedAt: null },
        data: { status: 'NO_SHOW', updatedAt: now },
      })
      .catch(() => undefined);
  }

  if (action === 'COMPLETED') {
    await db.tripLog
      .create({
        data: {
          tenantId,
          scheduleId,
          actualArrivalTime: now,
          driverNotes: `Auto-completed by telemetry (${TELEMETRY_SOURCE}): ${reason}`,
          loggedBy: TELEMETRY_SOURCE,
        },
      })
      .catch(() => undefined);
  }
}

/**
 * Evaluate one GPS ping with geofence drift handling.
 * Shadow mode logs only; live mode applies writes.
 */
export async function evaluateTelemetryTripTransitions(
  db: PrismaClient,
  ping: TelemetryPing,
  opts?: { mode?: TelemetryMode },
): Promise<TelemetryResult> {
  const mode = opts?.mode ?? resolveTelemetryMode();
  if (mode === 'off') {
    return { action: 'NONE', reason: 'telemetry mode off', mode, applied: false };
  }

  const now = ping.occurredAt ?? new Date();
  const schedule = await loadSchedule(db, ping, now);
  if (!schedule) {
    return { action: 'NONE', reason: 'no active schedule for vehicle', mode, applied: false };
  }

  const samples = await loadRecentSamples(db, ping, schedule.id, now);
  const decision = decideTelemetryTransition(schedule, ping, samples, now);

  if (decision.action === 'NONE') {
    return { ...decision, mode, applied: false };
  }

  if (mode === 'shadow') {
    console.info(
      JSON.stringify({
        tag: 'telemetry.trip.shadow',
        would: decision.action,
        from: decision.from,
        to: decision.to,
        scheduleId: decision.scheduleId,
        reason: decision.reason,
        evidence: decision.evidence,
        at: now.toISOString(),
      }),
    );
    return { ...decision, mode: 'shadow', applied: false };
  }

  try {
    await applyDecision(db, decision, now, schedule.tenantId);
    console.info(
      JSON.stringify({
        tag: 'telemetry.trip.live',
        applied: decision.action,
        from: decision.from,
        to: decision.to,
        scheduleId: decision.scheduleId,
        reason: decision.reason,
        evidence: decision.evidence,
        at: now.toISOString(),
      }),
    );
    return { ...decision, mode: 'live', applied: true };
  } catch (e) {
    console.warn('[telemetry.trip] apply failed', e);
    return {
      action: 'NONE',
      reason: `apply failed: ${e instanceof Error ? e.message : String(e)}`,
      mode: 'live',
      applied: false,
    };
  }
}
