/**
 * Deterministic Service Request ID display.
 *
 * Backend may eventually populate `readableId` on each ServiceRequest. Until
 * then, we derive a friendly ticker like "SR2026-10001" from the order of
 * creation, per year. The same UUID always gets the same readable ID across
 * renders (sort is stable on createdAt → date → id).
 *
 * Sequence per year starts at 10001.
 *
 *   const map = buildServiceRequestIdMap(requests);
 *   formatServiceRequestId(request, map)   // "SR2026-10001"
 */

import type { ServiceRequest } from '@/types/maintenance';

const FIRST_SEQ = 10001;

export function buildServiceRequestIdMap(requests: ServiceRequest[]): Map<string, string> {
  const sorted = [...requests].sort((a, b) => {
    const da = new Date(a.createdAt ?? a.date ?? 0).getTime();
    const db = new Date(b.createdAt ?? b.date ?? 0).getTime();
    if (da !== db) return da - db;
    return a.id.localeCompare(b.id); // stable tie-breaker
  });

  const counters = new Map<number, number>();
  const map = new Map<string, string>();
  for (const r of sorted) {
    if (r.readableId) {
      map.set(r.id, r.readableId);
      continue;
    }
    const ts = new Date(r.createdAt ?? r.date ?? Date.now());
    const year = isFinite(ts.getTime()) ? ts.getFullYear() : new Date().getFullYear();
    const next = (counters.get(year) ?? FIRST_SEQ - 1) + 1;
    counters.set(year, next);
    map.set(r.id, `SR${year}-${String(next).padStart(5, '0')}`);
  }
  return map;
}

export function formatServiceRequestId(
  request: ServiceRequest,
  map: Map<string, string>,
): string {
  return request.readableId ?? map.get(request.id) ?? request.id;
}
