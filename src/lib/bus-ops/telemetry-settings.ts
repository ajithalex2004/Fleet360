/**
 * Per-tenant Bus Ops telemetry settings (auto Start / Complete).
 * Stored in bus_ops_telemetry_settings; env remains emergency override.
 */

import type { PrismaClient } from '@prisma/client';
import type { TelemetryMode } from '@/lib/bus-ops/telemetry-trip-transitions';

export type TelemetrySettingsDTO = {
  mode: TelemetryMode;
  /** When true, hysteresis/dwells use formulas unless a fixed value is set */
  useFormulas: boolean;
  hysteresisM: number | null;
  startDwellMs: number | null;
  completeDwellMs: number | null;
  startSpeedKmh: number | null;
  completeSpeedKmh: number | null;
  maxAccuracyM: number | null;
  startWindowMin: number | null;
  updatedAt: string | null;
  updatedBy: string | null;
};

export const TELEMETRY_SETTINGS_DEFAULTS: TelemetrySettingsDTO = {
  mode: 'shadow',
  useFormulas: true,
  hysteresisM: null,
  startDwellMs: null,
  completeDwellMs: null,
  startSpeedKmh: null,
  completeSpeedKmh: null,
  maxAccuracyM: null,
  startWindowMin: null,
  updatedAt: null,
  updatedBy: null,
};

let ensured = false;

export async function ensureTelemetrySettingsTable(db: PrismaClient): Promise<void> {
  if (ensured) return;
  await db.$executeRawUnsafe(`
    CREATE TABLE IF NOT EXISTS bus_ops_telemetry_settings (
      tenant_id           TEXT PRIMARY KEY,
      mode                TEXT NOT NULL DEFAULT 'shadow',
      use_formulas        BOOLEAN NOT NULL DEFAULT TRUE,
      hysteresis_m        DOUBLE PRECISION NULL,
      start_dwell_ms      INTEGER NULL,
      complete_dwell_ms   INTEGER NULL,
      start_speed_kmh     DOUBLE PRECISION NULL,
      complete_speed_kmh  DOUBLE PRECISION NULL,
      max_accuracy_m      DOUBLE PRECISION NULL,
      start_window_min    INTEGER NULL,
      updated_at          TIMESTAMPTZ NULL DEFAULT NOW(),
      updated_by          TEXT NULL
    )
  `);
  ensured = true;
}

type Row = {
  tenant_id: string;
  mode: string;
  use_formulas: boolean;
  hysteresis_m: number | null;
  start_dwell_ms: number | null;
  complete_dwell_ms: number | null;
  start_speed_kmh: number | null;
  complete_speed_kmh: number | null;
  max_accuracy_m: number | null;
  start_window_min: number | null;
  updated_at: Date | null;
  updated_by: string | null;
};

function rowToDto(row: Row | null | undefined): TelemetrySettingsDTO {
  if (!row) return { ...TELEMETRY_SETTINGS_DEFAULTS };
  const mode = (row.mode || 'shadow').toLowerCase();
  return {
    mode: mode === 'live' || mode === 'off' || mode === 'shadow' ? mode : 'shadow',
    useFormulas: row.use_formulas !== false,
    hysteresisM: row.hysteresis_m != null ? Number(row.hysteresis_m) : null,
    startDwellMs: row.start_dwell_ms != null ? Number(row.start_dwell_ms) : null,
    completeDwellMs: row.complete_dwell_ms != null ? Number(row.complete_dwell_ms) : null,
    startSpeedKmh: row.start_speed_kmh != null ? Number(row.start_speed_kmh) : null,
    completeSpeedKmh: row.complete_speed_kmh != null ? Number(row.complete_speed_kmh) : null,
    maxAccuracyM: row.max_accuracy_m != null ? Number(row.max_accuracy_m) : null,
    startWindowMin: row.start_window_min != null ? Number(row.start_window_min) : null,
    updatedAt: row.updated_at ? new Date(row.updated_at).toISOString() : null,
    updatedBy: row.updated_by ?? null,
  };
}

export async function getTelemetrySettings(
  db: PrismaClient,
  tenantId: string,
): Promise<TelemetrySettingsDTO> {
  await ensureTelemetrySettingsTable(db);
  const rows = await db.$queryRawUnsafe<Row[]>(
    `SELECT * FROM bus_ops_telemetry_settings WHERE tenant_id = $1 LIMIT 1`,
    tenantId,
  );
  return rowToDto(rows[0]);
}

function numOrNull(v: unknown): number | null {
  if (v === null || v === undefined || v === '') return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

export function validateTelemetrySettingsPatch(
  body: Record<string, unknown>,
): { ok: true; data: Partial<TelemetrySettingsDTO> } | { ok: false; error: string } {
  const data: Partial<TelemetrySettingsDTO> = {};

  if (body.mode !== undefined) {
    const m = String(body.mode).toLowerCase();
    if (m !== 'shadow' && m !== 'live' && m !== 'off') {
      return { ok: false, error: 'mode must be shadow | live | off' };
    }
    data.mode = m;
  }
  if (body.useFormulas !== undefined) data.useFormulas = Boolean(body.useFormulas);

  const pairs: Array<[keyof TelemetrySettingsDTO, string, number, number]> = [
    ['hysteresisM', 'hysteresisM', 0, 200],
    ['startDwellMs', 'startDwellMs', 0, 600_000],
    ['completeDwellMs', 'completeDwellMs', 0, 600_000],
    ['startSpeedKmh', 'startSpeedKmh', 0, 120],
    ['completeSpeedKmh', 'completeSpeedKmh', 0, 60],
    ['maxAccuracyM', 'maxAccuracyM', 0, 500],
    ['startWindowMin', 'startWindowMin', 1, 240],
  ];

  for (const [key, bodyKey, min, max] of pairs) {
    if (body[bodyKey] === undefined) continue;
    if (body[bodyKey] === null || body[bodyKey] === '') {
      (data as Record<string, unknown>)[key] = null;
      continue;
    }
    const n = numOrNull(body[bodyKey]);
    if (n == null) return { ok: false, error: `${bodyKey} must be a number or null` };
    if (n < min || n > max) return { ok: false, error: `${bodyKey} must be between ${min} and ${max}` };
    (data as Record<string, unknown>)[key] = n;
  }

  return { ok: true, data };
}

export async function upsertTelemetrySettings(
  db: PrismaClient,
  tenantId: string,
  patch: Partial<TelemetrySettingsDTO>,
  updatedBy?: string | null,
): Promise<TelemetrySettingsDTO> {
  await ensureTelemetrySettingsTable(db);
  const current = await getTelemetrySettings(db, tenantId);
  const next: TelemetrySettingsDTO = {
    ...current,
    ...patch,
    updatedAt: new Date().toISOString(),
    updatedBy: updatedBy ?? current.updatedBy,
  };

  await db.$executeRawUnsafe(
    `INSERT INTO bus_ops_telemetry_settings (
       tenant_id, mode, use_formulas, hysteresis_m, start_dwell_ms, complete_dwell_ms,
       start_speed_kmh, complete_speed_kmh, max_accuracy_m, start_window_min, updated_at, updated_by
     ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,NOW(),$11)
     ON CONFLICT (tenant_id) DO UPDATE SET
       mode = EXCLUDED.mode,
       use_formulas = EXCLUDED.use_formulas,
       hysteresis_m = EXCLUDED.hysteresis_m,
       start_dwell_ms = EXCLUDED.start_dwell_ms,
       complete_dwell_ms = EXCLUDED.complete_dwell_ms,
       start_speed_kmh = EXCLUDED.start_speed_kmh,
       complete_speed_kmh = EXCLUDED.complete_speed_kmh,
       max_accuracy_m = EXCLUDED.max_accuracy_m,
       start_window_min = EXCLUDED.start_window_min,
       updated_at = NOW(),
       updated_by = EXCLUDED.updated_by`,
    tenantId,
    next.mode,
    next.useFormulas,
    next.hysteresisM,
    next.startDwellMs,
    next.completeDwellMs,
    next.startSpeedKmh,
    next.completeSpeedKmh,
    next.maxAccuracyM,
    next.startWindowMin,
    next.updatedBy,
  );

  return getTelemetrySettings(db, tenantId);
}

/**
 * Build process.env-style overrides for the telemetry engine.
 * Env vars still win when already set (emergency ops override).
 */
export function applyTelemetrySettingsToEnv(
  settings: TelemetrySettingsDTO,
  env: NodeJS.ProcessEnv = process.env,
): void {
  // Mode: tenant setting applies only if env MODE not set
  if (!env.TELEMETRY_TRIP_MODE || !String(env.TELEMETRY_TRIP_MODE).trim()) {
    env.TELEMETRY_TRIP_MODE = settings.mode;
  }

  if (settings.startSpeedKmh != null && !env.TELEMETRY_START_SPEED_KMH) {
    env.TELEMETRY_START_SPEED_KMH = String(settings.startSpeedKmh);
  }
  if (settings.completeSpeedKmh != null && !env.TELEMETRY_COMPLETE_SPEED_KMH) {
    env.TELEMETRY_COMPLETE_SPEED_KMH = String(settings.completeSpeedKmh);
  }
  if (settings.maxAccuracyM != null && !env.TELEMETRY_MAX_ACCURACY_M) {
    env.TELEMETRY_MAX_ACCURACY_M = String(settings.maxAccuracyM);
  }
  if (settings.startWindowMin != null && !env.TELEMETRY_START_WINDOW_MIN) {
    env.TELEMETRY_START_WINDOW_MIN = String(settings.startWindowMin);
  }

  // Fixed hysteresis/dwell only when useFormulas is false OR value explicitly set
  if (settings.hysteresisM != null && (!settings.useFormulas || true)) {
    // Explicit number always means fixed override for this process tick
    if (!env.TELEMETRY_HYSTERESIS_M) {
      env.TELEMETRY_HYSTERESIS_M = String(settings.hysteresisM);
    }
  }
  if (settings.startDwellMs != null && !env.TELEMETRY_START_DWELL_MS) {
    env.TELEMETRY_START_DWELL_MS = String(settings.startDwellMs);
  }
  if (settings.completeDwellMs != null && !env.TELEMETRY_COMPLETE_DWELL_MS) {
    env.TELEMETRY_COMPLETE_DWELL_MS = String(settings.completeDwellMs);
  }

  // When useFormulas and no fixed numbers, clear process overrides so formulas run
  if (settings.useFormulas) {
    if (settings.hysteresisM == null) delete env.TELEMETRY_HYSTERESIS_M;
    if (settings.startDwellMs == null) delete env.TELEMETRY_START_DWELL_MS;
    if (settings.completeDwellMs == null) delete env.TELEMETRY_COMPLETE_DWELL_MS;
  }
}
