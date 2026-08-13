/**
 * Enterprise data-residency DB router.
 *
 * Maps a tenant's `dataResidency` value to the correct Prisma client.
 * ENTERPRISE tenants with a region set to EU / UAE / US are served from
 * a dedicated regional Neon project whose DATABASE_URL is supplied via a
 * per-region env var. All other tenants (GLOBAL or unset) use the shared
 * primary Prisma singleton from src/lib/prisma.ts.
 *
 * Regional clients are created lazily on first use and cached for the
 * lifetime of the process (same behaviour as the primary singleton).
 *
 * Usage:
 *   import { getPrismaForTenant } from '@/lib/db-router';
 *   const db = await getPrismaForTenant(tenantId, plan);
 *   await withTenantRls(db, tenantId, async (tx) => { ... });
 *
 * If a regional DATABASE_URL_* env var is absent the router falls back to
 * the global primary — this is intentional: it lets you onboard the feature
 * incrementally without breaking existing ENTERPRISE tenants before you
 * provision their regional DB.
 */

import { PrismaClient } from '@prisma/client';
import { prisma } from '@/lib/prisma';

// ── Supported residency regions ──────────────────────────────────────────────

export type DataResidency = 'GLOBAL' | 'EU' | 'UAE' | 'US';

/** Map region → DATABASE_URL env-var name. */
const REGION_ENV_VARS: Record<Exclude<DataResidency, 'GLOBAL'>, string> = {
  EU:  'DATABASE_URL_EU',
  UAE: 'DATABASE_URL_UAE',
  US:  'DATABASE_URL_US',
};

// ── Regional client cache ────────────────────────────────────────────────────

// One PrismaClient per region, created lazily. The cache is keyed on the
// region string (never the URL) to avoid secret leakage in object keys.
const _regionalClients = new Map<string, PrismaClient>();

function getOrCreateRegionalClient(region: Exclude<DataResidency, 'GLOBAL'>): PrismaClient | null {
  const envVar = REGION_ENV_VARS[region];
  const url    = process.env[envVar];

  if (!url) {
    console.warn(
      `[db-router] ${envVar} is not set — ENTERPRISE tenant in region "${region}" ` +
      'will fall back to the global primary DB. Set the env var to enable regional isolation.',
    );
    return null;
  }

  if (!_regionalClients.has(region)) {
    const client = new PrismaClient({
      datasources: { db: { url } },
      log: process.env.NODE_ENV === 'development' ? ['error', 'warn'] : ['error'],
    });
    _regionalClients.set(region, client);
  }

  return _regionalClients.get(region)!;
}

// ── Tenant residency lookup ──────────────────────────────────────────────────

// LRU-style in-process cache to avoid a DB round-trip on every request.
// TTL is intentionally short (5 min) so residency changes at onboarding
// propagate quickly without a full deploy.
const CACHE_TTL_MS = 5 * 60 * 1_000;

interface CacheEntry {
  residency: DataResidency;
  expiry:    number;
}

const _residencyCache = new Map<string, CacheEntry>();

/**
 * Look up a tenant's `data_residency` from the primary DB (once per TTL).
 * Falls back to 'GLOBAL' on any error — never throws.
 */
async function getTenantResidency(tenantId: string): Promise<DataResidency> {
  const cached = _residencyCache.get(tenantId);
  if (cached && cached.expiry > Date.now()) {
    return cached.residency;
  }

  try {
    // Raw SQL to avoid Prisma client cache staleness when the column was
    // just added and the generated client hasn't been regenerated yet.
    type Row = { data_residency: string };
    const rows = await prisma.$queryRaw<Row[]>`
      SELECT data_residency FROM tenants WHERE id = ${tenantId} LIMIT 1
    `;
    const raw      = rows[0]?.data_residency ?? 'GLOBAL';
    const residency = (['GLOBAL', 'EU', 'UAE', 'US'] as const).includes(raw as DataResidency)
      ? (raw as DataResidency)
      : 'GLOBAL';

    _residencyCache.set(tenantId, { residency, expiry: Date.now() + CACHE_TTL_MS });
    return residency;
  } catch (err) {
    console.error('[db-router] Failed to read tenant residency:', err instanceof Error ? err.message : err);
    return 'GLOBAL';
  }
}

// ── Public API ───────────────────────────────────────────────────────────────

/**
 * Return the correct Prisma client for a given tenant.
 *
 * For ENTERPRISE tenants with a configured regional DB, returns the
 * regional client. For everyone else, returns the global primary.
 *
 * Pass `plan` (from the session token) so non-ENTERPRISE tenants skip
 * the residency DB lookup entirely — saves a round-trip on every request.
 */
export async function getPrismaForTenant(
  tenantId: string,
  plan: string,
): Promise<PrismaClient> {
  // Only ENTERPRISE tenants can have a regional residency assignment.
  if (plan !== 'ENTERPRISE') return prisma;

  const residency = await getTenantResidency(tenantId);
  if (residency === 'GLOBAL') return prisma;

  const regional = getOrCreateRegionalClient(residency);
  return regional ?? prisma; // fall back if env var absent
}

/**
 * Return a Prisma client for a given residency region directly.
 * Useful for system jobs that already know the region without a tenant lookup.
 * Returns the global primary for GLOBAL or unconfigured regions.
 */
export function getPrismaForRegion(residency: DataResidency): PrismaClient {
  if (residency === 'GLOBAL') return prisma;
  const client = getOrCreateRegionalClient(residency);
  return client ?? prisma;
}

/**
 * Invalidate the residency cache entry for a tenant (call after provisioning
 * or after an admin changes a tenant's residency setting).
 */
export function invalidateResidencyCache(tenantId: string): void {
  _residencyCache.delete(tenantId);
}
