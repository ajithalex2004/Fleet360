/**
 * Canonical fuel (0–100% integer) and odometer normalization & dual-column
 * synchronization helpers for the Rent-A-Car (RAC) module.
 *
 * Eliminates the split-brain between Prisma columns (`mileage_out`, `mileage_in`,
 * `fuel_out`, `fuel_in`) and raw-SQL columns (`pickup_odometer`, `return_odometer`,
 * `pickup_fuel_level`, `return_fuel_level`), as well as the `0–8` eighths vs
 * `0–100%` percentage ambiguity.
 */

export type FuelUnit = 'PCT' | 'EIGHTHS';

function clampInt(n: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, Math.round(n)));
}

/**
 * Converts a raw fuel input (number, fraction string like `"6/8"`, `"3/4"`,
 * percentage string `"75%"`, label `"FULL"`/`"HALF"`/`"EMPTY"`, or eighths/pct)
 * into canonical integer `0..100` percentage.
 */
export function normalizeFuelToPct(
  rawValue: unknown,
  opts?: {
    unit?: FuelUnit | null;
    defaultUnitFor0To8?: FuelUnit;
  },
): number | null {
  if (rawValue === undefined || rawValue === null || rawValue === '') {
    return null;
  }

  const explicitUnit = opts?.unit ?? null;

  if (typeof rawValue === 'string') {
    const trimmed = rawValue.trim();
    if (!trimmed) return null;
    const upper = trimmed.toUpperCase();

    if (upper === 'FULL' || upper === 'F') return 100;
    if (upper === 'EMPTY' || upper === 'E') return 0;
    if (upper === 'HALF' || upper === '1/2') return 50;
    if (upper === '1/4' || upper === 'QUARTER') return 25;
    if (upper === '3/4' || upper === 'THREE_QUARTERS') return 75;

    if (upper.endsWith('%')) {
      const pctNum = Number(upper.slice(0, -1).trim());
      return Number.isFinite(pctNum) ? clampInt(pctNum, 0, 100) : null;
    }

    const fracMatch = /^(\d+(?:\.\d+)?)\s*\/\s*(\d+(?:\.\d+)?)$/.exec(upper);
    if (fracMatch) {
      const num = Number(fracMatch[1]);
      const den = Number(fracMatch[2]);
      if (Number.isFinite(num) && Number.isFinite(den) && den > 0) {
        return clampInt((num / den) * 100, 0, 100);
      }
      return null;
    }

    const parsed = Number(trimmed);
    if (!Number.isFinite(parsed)) return null;
    rawValue = parsed;
  }

  if (typeof rawValue !== 'number' || !Number.isFinite(rawValue)) {
    return null;
  }

  if (rawValue < 0) return 0;

  if (explicitUnit === 'EIGHTHS') {
    return clampInt((clampInt(rawValue, 0, 8) / 8) * 100, 0, 100);
  }
  if (explicitUnit === 'PCT') {
    return clampInt(rawValue, 0, 100);
  }

  // Fallback when caller omitted explicit unit:
  const fallback0To8 = opts?.defaultUnitFor0To8 ?? 'PCT';
  if (fallback0To8 === 'EIGHTHS' && rawValue <= 8) {
    return clampInt((rawValue / 8) * 100, 0, 100);
  }

  return clampInt(rawValue, 0, 100);
}

/**
 * Resolves pickup or return fuel percentage (`0..100`) from an incoming API
 * request body, honoring explicit `*Pct` (`0..100`), `*Eighths` (`0..8`), and
 * `fuelUnit` (`'PCT' | 'EIGHTHS'`) fields so `8%` is never misread as `8/8`.
 */
export function resolveInputFuelPct(
  body: Record<string, unknown>,
  stage: 'pickup' | 'return',
  defaultUnitFor0To8: FuelUnit = 'PCT',
): number | null {
  const rawUnit = String(
    (stage === 'pickup' ? body.pickupFuelUnit ?? body.fuelOutUnit : body.returnFuelUnit ?? body.fuelInUnit) ??
      body.fuelUnit ??
      '',
  )
    .trim()
    .toUpperCase();
  const explicitUnit: FuelUnit | null =
    rawUnit === 'EIGHTHS' || rawUnit === '8THS'
      ? 'EIGHTHS'
      : rawUnit === 'PCT' || rawUnit === 'PERCENT' || rawUnit === '%'
        ? 'PCT'
        : null;

  if (stage === 'pickup') {
    const pctCandidate =
      body.fuelOutPct ??
      body.pickupFuelPct ??
      body.pickupFuelLevel ??
      body.pickup_fuel_level;
    if (pctCandidate !== undefined && pctCandidate !== null && pctCandidate !== '') {
      return normalizeFuelToPct(pctCandidate, { unit: explicitUnit ?? 'PCT' });
    }

    const eighthsCandidate = body.fuelOutEighths ?? body.pickupFuelEighths;
    if (eighthsCandidate !== undefined && eighthsCandidate !== null && eighthsCandidate !== '') {
      return normalizeFuelToPct(eighthsCandidate, { unit: 'EIGHTHS' });
    }

    const generic = body.fuelOut ?? body.fuel_out ?? body.fuelLevel ?? body.fuel_level;
    return normalizeFuelToPct(generic, {
      unit: explicitUnit,
      defaultUnitFor0To8,
    });
  }

  const pctCandidate =
    body.fuelInPct ??
    body.returnFuelPct ??
    body.returnFuelLevel ??
    body.return_fuel_level;
  if (pctCandidate !== undefined && pctCandidate !== null && pctCandidate !== '') {
    return normalizeFuelToPct(pctCandidate, { unit: explicitUnit ?? 'PCT' });
  }

  const eighthsCandidate = body.fuelInEighths ?? body.returnFuelEighths;
  if (eighthsCandidate !== undefined && eighthsCandidate !== null && eighthsCandidate !== '') {
    return normalizeFuelToPct(eighthsCandidate, { unit: 'EIGHTHS' });
  }

  const generic = body.fuelIn ?? body.fuel_in ?? body.fuelLevel ?? body.fuel_level;
  return normalizeFuelToPct(generic, {
    unit: explicitUnit,
    defaultUnitFor0To8,
  });
}

/**
 * Reads canonical `0..100%` fuel from stored DB columns (`pickup_fuel_level` +
 * `fuel_out`, or `return_fuel_level` + `fuel_in`).
 *
 * - `pctColumn` (`pickup_fuel_level` / `return_fuel_level`) is always stored in `0..100%`.
 * - If `pctColumn` is null (legacy rows created before consolidation), `legacyColumn`
 *   (`fuel_out` / `fuel_in`) in `1..8` is upgraded from eighths to `0..100%`.
 */
export function resolveStoredFuelPct(
  pctColumn: unknown,
  legacyColumn?: unknown,
): number | null {
  if (pctColumn !== undefined && pctColumn !== null && pctColumn !== '') {
    const n = Number(pctColumn);
    if (Number.isFinite(n)) return clampInt(n, 0, 100);
  }
  if (legacyColumn !== undefined && legacyColumn !== null && legacyColumn !== '') {
    if (typeof legacyColumn === 'string' && (legacyColumn.includes('/') || legacyColumn.includes('%'))) {
      return normalizeFuelToPct(legacyColumn, { defaultUnitFor0To8: 'EIGHTHS' });
    }
    const n = Number(legacyColumn);
    if (Number.isFinite(n)) {
      if (n > 0 && n <= 8 && Number.isInteger(n)) {
        return clampInt((n / 8) * 100, 0, 100);
      }
      return clampInt(n, 0, 100);
    }
  }
  return null;
}

/**
 * Resolves canonical odometer reading (`>= 0` integer km) from dual columns.
 */
export function resolveStoredOdometerKm(
  primaryColumn: unknown,
  secondaryColumn?: unknown,
): number | null {
  for (const candidate of [primaryColumn, secondaryColumn]) {
    if (candidate !== undefined && candidate !== null && candidate !== '') {
      const n = Number(candidate);
      if (Number.isFinite(n) && n >= 0) {
        return Math.round(n);
      }
    }
  }
  return null;
}

/**
 * Converts canonical `0..100%` fuel into nearest eighths (`0..8`) for gauges.
 */
export function pctToEighths(fuelPct: number | null | undefined): number {
  if (fuelPct == null || !Number.isFinite(Number(fuelPct))) return 8;
  return clampInt((clampInt(Number(fuelPct), 0, 100) / 100) * 8, 0, 8);
}

/**
 * Formats a fuel value (canonical `%`, legacy `0..8`, or string) for human
 * display on PDFs and UI cards without ever printing `"75/8"`.
 */
export function formatCanonicalFuelDisplay(
  rawFuel: unknown,
  opts?: { pctColumn?: unknown; includeEighths?: boolean },
): string {
  const pct =
    opts?.pctColumn !== undefined
      ? resolveStoredFuelPct(opts.pctColumn, rawFuel)
      : typeof rawFuel === 'string'
        ? normalizeFuelToPct(rawFuel, { defaultUnitFor0To8: 'PCT' })
        : resolveStoredFuelPct(null, rawFuel);

  if (pct == null) return '—';
  if (opts?.includeEighths === false) return `${pct}%`;
  const eighths = pctToEighths(pct);
  return `${pct}% (${eighths}/8)`;
}
