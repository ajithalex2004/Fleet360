export const dynamic = 'force-dynamic';

/**
 * POST /api/bus-ops/planning/evaluate — Planning Constraint Engine entry point.
 *
 * Callers (merge UI, bulk-reassignment tool, future optimiser) POST a
 * plan description and get back `{verdict, checks[], totalPenalty}`.
 *
 * Request body:
 *   {
 *     tenantTimezone?: string,          // default 'Asia/Dubai'
 *     existing?: [{tripId, role}],      // trips already in the DB
 *     proposed?: [{                     // trips being invented by the caller
 *       id, role, routeId, vehicleId?, driverId?,
 *       departureTime, arrivalTime?, latestArrivalTime?, confirmedCount,
 *       stops: [{placeId, lat, lng, sequence}],
 *       vehicleOverride?: {seatingCapacity, vehicleGroup}
 *     }]
 *   }
 *
 * Response — the raw evaluator output. `verdict:'BLOCK'` returns 409 so
 * the client can key on HTTP status; WARN and PASS return 200 with the
 * checks array intact.
 */

import { NextRequest, NextResponse } from 'next/server';
import { withTenantRls } from '@/lib/rls';
import { loadPlanFacts, type ExistingTripInput, type ProposedTripInput } from '@/lib/planning/facts';
import { evaluatePlan } from '@/lib/planning/evaluate-plan';

import { requireAuthorizedTenant, stripTenantOwnershipFields } from '@/lib/tenant-context';
const ROLES = new Set(['source', 'merged', 'standalone']);

export async function POST(req: NextRequest) {
  const authz = requireAuthorizedTenant({ headers: req.headers, nextUrl: req.nextUrl });

  if (!authz.ok) {

    return NextResponse.json({ error: authz.error }, { status: authz.status });

  }

  const { tenantId } = authz;

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: 'invalid JSON' }, { status: 400 });
  }
  if (!body || typeof body !== 'object') {
    return NextResponse.json({ error: 'body must be an object' }, { status: 400 });
  }
  const b = body as Record<string, unknown>;

  const existing = normaliseExisting(b.existing);
  if (typeof existing === 'string') {
    return NextResponse.json({ error: existing }, { status: 400 });
  }
  const proposed = normaliseProposed(b.proposed);
  if (typeof proposed === 'string') {
    return NextResponse.json({ error: proposed }, { status: 400 });
  }
  if (existing.length === 0 && proposed.length === 0) {
    return NextResponse.json({ error: 'plan must have at least one existing or proposed trip' }, { status: 400 });
  }
  const tenantTimezone = typeof b.tenantTimezone === 'string' ? b.tenantTimezone : undefined;

  try {
    const facts = await loadPlanFacts({ tenantId, tenantTimezone, existing, proposed });
    const result = evaluatePlan(facts);
    const status = result.verdict === 'BLOCK' ? 409 : 200;
    return NextResponse.json(result, { status });
    } catch (e) {
    console.error('[planning.evaluate]', e);
    return NextResponse.json({ error: 'Plan evaluation failed' }, { status: 500 });
  }
}

function normaliseExisting(raw: unknown): ExistingTripInput[] | string {
  if (raw === undefined || raw === null) return [];
  if (!Array.isArray(raw)) return 'existing must be an array';
  const out: ExistingTripInput[] = [];
  for (const [i, item] of raw.entries()) {
    if (!item || typeof item !== 'object') return `existing[${i}] must be an object`;
    const it = item as Record<string, unknown>;
    if (typeof it.tripId !== 'string' || !it.tripId) return `existing[${i}].tripId is required`;
    if (typeof it.role !== 'string' || !ROLES.has(it.role)) {
      return `existing[${i}].role must be one of ${[...ROLES].join('|')}`;
    }
    out.push({ tripId: it.tripId, role: it.role as ExistingTripInput['role'] });
  }
  return out;
}

function normaliseProposed(raw: unknown): ProposedTripInput[] | string {
  if (raw === undefined || raw === null) return [];
  if (!Array.isArray(raw)) return 'proposed must be an array';
  const out: ProposedTripInput[] = [];
  for (const [i, item] of raw.entries()) {
    if (!item || typeof item !== 'object') return `proposed[${i}] must be an object`;
    const it = item as Record<string, unknown>;
    if (typeof it.id !== 'string' || !it.id) return `proposed[${i}].id is required`;
    if (typeof it.role !== 'string' || !ROLES.has(it.role)) {
      return `proposed[${i}].role must be one of ${[...ROLES].join('|')}`;
    }
    if (typeof it.routeId !== 'string' || !it.routeId) return `proposed[${i}].routeId is required`;

    const dep = parseDate(it.departureTime);
    if (!dep) return `proposed[${i}].departureTime must be an ISO timestamp`;
    const arr = it.arrivalTime === undefined || it.arrivalTime === null ? null : parseDate(it.arrivalTime);
    if (arr === undefined) return `proposed[${i}].arrivalTime must be an ISO timestamp`;
    const sla = it.latestArrivalTime === undefined || it.latestArrivalTime === null
      ? null
      : parseDate(it.latestArrivalTime);
    if (sla === undefined) return `proposed[${i}].latestArrivalTime must be an ISO timestamp`;

    const confirmedCount = typeof it.confirmedCount === 'number' ? it.confirmedCount : 0;

    const stopsRaw = it.stops;
    if (stopsRaw !== undefined && !Array.isArray(stopsRaw)) {
      return `proposed[${i}].stops must be an array`;
    }
    const stops: ProposedTripInput['stops'] = [];
    for (const [j, s] of ((stopsRaw as unknown[]) ?? []).entries()) {
      if (!s || typeof s !== 'object') return `proposed[${i}].stops[${j}] must be an object`;
      const st = s as Record<string, unknown>;
      if (typeof st.placeId !== 'string') return `proposed[${i}].stops[${j}].placeId is required`;
      if (typeof st.lat !== 'number' || typeof st.lng !== 'number') {
        return `proposed[${i}].stops[${j}].lat/lng must be numbers`;
      }
      if (typeof st.sequence !== 'number') return `proposed[${i}].stops[${j}].sequence is required`;
      stops.push({ placeId: st.placeId, lat: st.lat, lng: st.lng, sequence: st.sequence });
    }

    let vehicleOverride: ProposedTripInput['vehicleOverride'];
    if (it.vehicleOverride && typeof it.vehicleOverride === 'object') {
      const v = it.vehicleOverride as Record<string, unknown>;
      vehicleOverride = {
        seatingCapacity: typeof v.seatingCapacity === 'number' ? v.seatingCapacity : null,
        vehicleGroup: typeof v.vehicleGroup === 'string' ? v.vehicleGroup : null,
      };
    }

    out.push({
      id: it.id,
      role: it.role as ProposedTripInput['role'],
      routeId: it.routeId,
      vehicleId: typeof it.vehicleId === 'string' ? it.vehicleId : null,
      driverId: typeof it.driverId === 'string' ? it.driverId : null,
      departureTime: dep,
      arrivalTime: arr,
      latestArrivalTime: sla,
      confirmedCount,
      stops,
      vehicleOverride,
    });
  }
  return out;
}

function parseDate(raw: unknown): Date | null | undefined {
  if (typeof raw !== 'string') return undefined;
  const d = new Date(raw);
  return Number.isNaN(d.getTime()) ? undefined : d;
}
