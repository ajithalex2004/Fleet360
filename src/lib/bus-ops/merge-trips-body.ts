/**
 * Shared body parsing for merge-trips preview + apply.
 *
 * Kept in one place so preview and apply agree on the wire contract —
 * one endpoint diverging from the other would produce silent
 * misbehaviour (preview says OK, apply refuses because it validated
 * something the preview didn't).
 */

import type { MergeInput } from '@/lib/bus-ops/merge-trips';

export function parseMergeInputBody(
  raw: unknown,
  tenantId: string
): { input: MergeInput } | { error: string } {
  if (!raw || typeof raw !== 'object') return { error: 'body must be an object' };
  const b = raw as Record<string, unknown>;

  if (!Array.isArray(b.sourceTripIds) || b.sourceTripIds.some((s) => typeof s !== 'string')) {
    return { error: 'sourceTripIds must be an array of strings' };
  }
  if (!b.merged || typeof b.merged !== 'object') return { error: 'merged must be an object' };
  const m = b.merged as Record<string, unknown>;

  if (typeof m.routeId !== 'string' || !m.routeId) return { error: 'merged.routeId is required' };
  if (typeof m.vehicleId !== 'string' || !m.vehicleId) return { error: 'merged.vehicleId is required' };
  if (typeof m.driverId !== 'string' || !m.driverId) return { error: 'merged.driverId is required' };

  const dep = parseDate(m.departureTime);
  if (!dep) return { error: 'merged.departureTime must be an ISO timestamp' };
  const arr = parseDate(m.arrivalTime);
  if (!arr) return { error: 'merged.arrivalTime must be an ISO timestamp' };
  const sla = m.latestArrivalTime === undefined || m.latestArrivalTime === null
    ? null
    : parseDate(m.latestArrivalTime);
  if (sla === undefined) return { error: 'merged.latestArrivalTime must be an ISO timestamp' };

  if (!Array.isArray(m.stops)) return { error: 'merged.stops must be an array' };
  const stops: MergeInput['merged']['stops'] = [];
  for (const [i, s] of m.stops.entries()) {
    if (!s || typeof s !== 'object') return { error: `merged.stops[${i}] must be an object` };
    const st = s as Record<string, unknown>;
    if (typeof st.placeId !== 'string') return { error: `merged.stops[${i}].placeId is required` };
    if (typeof st.lat !== 'number' || typeof st.lng !== 'number') {
      return { error: `merged.stops[${i}].lat/lng must be numbers` };
    }
    if (typeof st.sequence !== 'number') return { error: `merged.stops[${i}].sequence is required` };
    stops.push({ placeId: st.placeId, lat: st.lat, lng: st.lng, sequence: st.sequence });
  }

  return {
    input: {
      tenantId,
      tenantTimezone: typeof b.tenantTimezone === 'string' ? b.tenantTimezone : undefined,
      sourceTripIds: b.sourceTripIds as string[],
      merged: {
        routeId: m.routeId,
        vehicleId: m.vehicleId,
        driverId: m.driverId,
        departureTime: dep,
        arrivalTime: arr,
        latestArrivalTime: sla,
        stops,
        notes: typeof m.notes === 'string' ? m.notes : null,
      },
    },
  };
}

function parseDate(raw: unknown): Date | null | undefined {
  if (typeof raw !== 'string') return undefined;
  const d = new Date(raw);
  return Number.isNaN(d.getTime()) ? undefined : d;
}
