/**
 * Data residency: whether this deployment may serve a tenant whose data must
 * stay in a given region.
 *
 * A tenant's `data_residency` (GLOBAL | EU | UAE | US) is a contractual
 * promise about where its data lives. Route handlers use the primary Prisma
 * client (DATABASE_URL); none route through db-router's regional clients.
 * So the only way this deployment keeps a UAE tenant's data in the UAE is
 * for the deployment itself, and its DATABASE_URL, to be in the UAE.
 *
 * DATA_RESIDENCY_SERVED_REGIONS declares which regions this deployment
 * satisfies (comma-separated, e.g. "UAE" for a UAE-hosted deployment).
 * GLOBAL is always served. Any other region, and any unrecognised value, is
 * refused: fail closed, never fall back to the global database.
 *
 * Edge-runtime safe: no Node APIs, no database access.
 */

export const RESIDENCY_REGIONS = ['GLOBAL', 'EU', 'UAE', 'US'] as const;
export type DataResidency = (typeof RESIDENCY_REGIONS)[number];

/**
 * Normalises a stored or claimed residency value. Missing or empty means
 * GLOBAL. Returns null for a value that is not a known region, which callers
 * must treat as unservable.
 */
export function normalizeResidency(raw: unknown): DataResidency | null {
  if (raw === null || raw === undefined) return 'GLOBAL';
  const value = String(raw).trim().toUpperCase();
  if (value === '') return 'GLOBAL';
  return (RESIDENCY_REGIONS as readonly string[]).includes(value) ? (value as DataResidency) : null;
}

/** Regions this deployment satisfies: GLOBAL plus DATA_RESIDENCY_SERVED_REGIONS. */
export function servedResidencies(): Set<DataResidency> {
  const served = new Set<DataResidency>(['GLOBAL']);
  for (const part of (process.env.DATA_RESIDENCY_SERVED_REGIONS ?? '').split(',')) {
    if (!part.trim()) continue;
    const region = normalizeResidency(part);
    if (region) served.add(region);
  }
  return served;
}

/** True when this deployment may serve a tenant with this residency. */
export function canServeResidency(raw: unknown): boolean {
  const region = normalizeResidency(raw);
  return region !== null && servedResidencies().has(region);
}

/**
 * The `dataResidency` claim to sign into a session for a tenant with this
 * stored residency: omitted for GLOBAL, otherwise the region (or the raw
 * value when unrecognised, so middleware refuses it).
 */
export function residencySessionClaim(raw: unknown): { dataResidency?: string } {
  const region = normalizeResidency(raw);
  if (region === 'GLOBAL') return {};
  return { dataResidency: region ?? String(raw) };
}
