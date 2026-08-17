/**
 * Shared body parser for the Route Consolidation apply/preview endpoints.
 *
 * One place to canonicalise MergedRouteSpec, stopIds, fingerprints,
 * and operator resolutions so preview and apply agree on the wire
 * contract exactly. A divergence would silently produce "preview said
 * OK, apply refused" bugs.
 */

import type { ApplyConsolidationInput, EnrollmentKey, MergedRouteSpec, OperatorStopResolution, PreviewApplyInput } from '@/lib/planning/route-consolidation-apply';

export type ParseOptions = {
  /** Apply requires idempotencyKey; preview does not. */
  requireIdempotencyKey: boolean;
  /**
   * Trusted appliedBy from the x-user-id header. REQUIRED when
   * requireIdempotencyKey is true (i.e. this is an apply request).
   * Never sourced from the body — see the appliedBy body-rejection
   * check below.
   */
  appliedBy?: string;
};

/**
 * Body parser for /apply/preview and /apply.
 *
 * Audit-identity rule (SECURITY): `appliedBy` never comes from the
 * request body. It comes from the authenticated `x-user-id` header
 * only, passed through `opts.appliedBy`. A body-supplied `appliedBy`
 * is rejected LOUDLY with a 400 rather than silently ignored — the
 * caller learns immediately if they're constructing an unsafe
 * request. Same principle applies to `tenantId`.
 */
export function parseApplyBody(
  raw: unknown,
  tenantId: string,
  opts: ParseOptions
): { input: PreviewApplyInput | ApplyConsolidationInput } | { error: string } {
  if (!raw || typeof raw !== 'object') return { error: 'body must be an object' };
  const b = raw as Record<string, unknown>;

  // SECURITY: reject any attempt to specify audit identity from the body.
  // A caller passing appliedBy would otherwise mislead the audit trail
  // even though authentication used a different user.
  if ('appliedBy' in b) {
    return { error: 'appliedBy is not accepted from the request body; the authenticated user is used automatically' };
  }
  if ('tenantId' in b) {
    return { error: 'tenantId is not accepted from the request body; the authenticated tenant context is used automatically' };
  }

  if (typeof b.recommendationId !== 'string' || !b.recommendationId) {
    return { error: 'recommendationId (string) is required' };
  }
  if (!Array.isArray(b.sourceRouteIds) || b.sourceRouteIds.length < 2 || b.sourceRouteIds.some((v) => typeof v !== 'string')) {
    return { error: 'sourceRouteIds must be an array of >= 2 strings' };
  }
  const sourceRouteIds = b.sourceRouteIds as string[];

  if (!b.mergedRoute || typeof b.mergedRoute !== 'object') {
    return { error: 'mergedRoute must be an object' };
  }
  const merged = parseMergedRoute(b.mergedRoute as Record<string, unknown>);
  if ('error' in merged) return merged;

  const fingerprints = parseFingerprints(b.sourceRouteFingerprints);
  if ('error' in fingerprints) return fingerprints;

  const resolutions = parseOperatorResolutions(b.operatorResolutions);
  if ('error' in resolutions) return resolutions;

  const objective = b.objective !== undefined
    ? (typeof b.objective === 'object' && b.objective !== null && !Array.isArray(b.objective) ? b.objective as Record<string, unknown> : null)
    : undefined;
  if (objective === null) return { error: 'objective must be an object' };

  const base: PreviewApplyInput = {
    tenantId,
    recommendationId: b.recommendationId,
    sourceRouteIds,
    mergedRoute: merged.spec,
    sourceRouteFingerprints: fingerprints.value,
    operatorResolutions: resolutions.value,
    objective,
  };

  if (!opts.requireIdempotencyKey) return { input: base };

  if (typeof b.idempotencyKey !== 'string' || !b.idempotencyKey) {
    return { error: 'idempotencyKey (string) is required for apply' };
  }
  // appliedBy comes from opts (trusted header context) only — the body
  // check above already rejected any client attempt to override.
  const appliedBy = opts.appliedBy;
  if (!appliedBy) {
    // Route handler misuse — appliedBy wasn't passed in from the header.
    return { error: 'server misconfigured: apply parser invoked without trusted appliedBy' };
  }

  const recommendationSnapshot = b.recommendationSnapshot !== undefined
    ? (typeof b.recommendationSnapshot === 'object' && b.recommendationSnapshot !== null && !Array.isArray(b.recommendationSnapshot)
        ? b.recommendationSnapshot as Record<string, unknown>
        : null)
    : undefined;
  if (recommendationSnapshot === null) return { error: 'recommendationSnapshot must be an object' };

  const applyInput: ApplyConsolidationInput = {
    ...base,
    idempotencyKey: b.idempotencyKey,
    appliedBy,
    recommendationSnapshot,
  };
  return { input: applyInput };
}

function parseMergedRoute(m: Record<string, unknown>): { spec: MergedRouteSpec } | { error: string } {
  if (!Array.isArray(m.stopIds) || m.stopIds.length < 2 || m.stopIds.some((v) => typeof v !== 'string')) {
    return { error: 'mergedRoute.stopIds must be an array of >= 2 stop ids' };
  }
  const spec: MergedRouteSpec = { stopIds: m.stopIds as string[] };
  if (m.name !== undefined) {
    if (typeof m.name !== 'string') return { error: 'mergedRoute.name must be a string' };
    spec.name = m.name;
  }
  if (m.estimatedDurationMins !== undefined) {
    if (typeof m.estimatedDurationMins !== 'number' || !Number.isFinite(m.estimatedDurationMins)) {
      return { error: 'mergedRoute.estimatedDurationMins must be a finite number' };
    }
    spec.estimatedDurationMins = m.estimatedDurationMins;
  }
  if (m.capacity !== undefined) {
    if (typeof m.capacity !== 'number' || !Number.isFinite(m.capacity)) {
      return { error: 'mergedRoute.capacity must be a finite number' };
    }
    spec.capacity = m.capacity;
  }
  if (m.requiredVehicleGroup !== undefined) {
    if (m.requiredVehicleGroup !== null && typeof m.requiredVehicleGroup !== 'string') {
      return { error: 'mergedRoute.requiredVehicleGroup must be string or null' };
    }
    spec.requiredVehicleGroup = m.requiredVehicleGroup as string | null;
  }
  if (m.totalDistanceKm !== undefined) {
    if (m.totalDistanceKm !== null && (typeof m.totalDistanceKm !== 'number' || !Number.isFinite(m.totalDistanceKm))) {
      return { error: 'mergedRoute.totalDistanceKm must be a finite number or null' };
    }
    spec.totalDistanceKm = m.totalDistanceKm as number | null;
  }
  if (m.notes !== undefined) {
    if (m.notes !== null && typeof m.notes !== 'string') return { error: 'mergedRoute.notes must be string or null' };
    spec.notes = m.notes as string | null;
  }
  return { spec };
}

function parseFingerprints(raw: unknown): { value?: Record<string, string> } | { error: string } {
  if (raw === undefined || raw === null) return { value: undefined };
  if (typeof raw !== 'object' || Array.isArray(raw)) return { error: 'sourceRouteFingerprints must be an object' };
  const out: Record<string, string> = {};
  for (const [k, v] of Object.entries(raw)) {
    if (typeof v !== 'string') return { error: `sourceRouteFingerprints.${k} must be a string (ISO timestamp)` };
    out[k] = v;
  }
  return { value: out };
}

/**
 * UUID v4 (or general 8-4-4-4-12) format check. RoutePassenger.id is
 * UUID in the DB; the RP: portion of an operatorResolutions key must
 * match. TE: keys are TEXT (transport_enrollments.id is TEXT), so
 * they're only length-checked. Prisma parameterises the value, so
 * this is defence-in-depth clarity, not injection protection.
 */
const UUID_RE = /^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$/;
const KEY_RE  = /^(RP|TE):(.+)$/;

function parseOperatorResolutions(raw: unknown): { value?: Record<EnrollmentKey, OperatorStopResolution> } | { error: string } {
  if (raw === undefined || raw === null) return { value: undefined };
  if (typeof raw !== 'object' || Array.isArray(raw)) return { error: 'operatorResolutions must be an object' };
  const out: Record<EnrollmentKey, OperatorStopResolution> = {};
  for (const [k, v] of Object.entries(raw)) {
    const m = KEY_RE.exec(k);
    if (!m) return { error: `operatorResolutions key ${k} must be "RP:<id>" or "TE:<id>"` };
    const [, type, id] = m;
    if (type === 'RP' && !UUID_RE.test(id)) {
      return { error: `operatorResolutions key ${k}: RoutePassenger id must be a UUID` };
    }
    if (!v || typeof v !== 'object' || Array.isArray(v)) return { error: `operatorResolutions.${k} must be an object` };
    const rv = v as Record<string, unknown>;
    const resolution: OperatorStopResolution = {};
    if (rv.pickupStopId !== undefined) {
      if (rv.pickupStopId !== null && typeof rv.pickupStopId !== 'string') return { error: `operatorResolutions.${k}.pickupStopId must be string or null` };
      resolution.pickupStopId = rv.pickupStopId as string | null;
    }
    if (rv.dropoffStopId !== undefined) {
      if (rv.dropoffStopId !== null && typeof rv.dropoffStopId !== 'string') return { error: `operatorResolutions.${k}.dropoffStopId must be string or null` };
      resolution.dropoffStopId = rv.dropoffStopId as string | null;
    }
    out[k as EnrollmentKey] = resolution;
  }
  return { value: out };
}
