/**
 * Data-residency DB router.
 *
 * Maps a tenant's `data_residency` (GLOBAL | EU | UAE | US) to the Prisma
 * client whose database satisfies it, and FAILS CLOSED: a tenant whose region
 * cannot be satisfied gets a DataResidencyUnavailableError, never the global
 * primary. (It used to fall back to the global primary with a warning, which
 * for a residency-bound customer is a breach, not a degraded mode.)
 *
 * Resolution for a non-GLOBAL tenant:
 *   1. This deployment serves the region (DATA_RESIDENCY_SERVED_REGIONS, see
 *      src/lib/data-residency.ts): its primary DATABASE_URL is in-region, so
 *      the primary client is correct.
 *   2. Otherwise a regional DATABASE_URL_<REGION> client, if configured.
 *   3. Otherwise throw.
 *
 * NOTE: route handlers do not call this router today; they use the primary
 * client directly. Middleware therefore refuses tenants whose region this
 * deployment does not serve (canServeResidency), and a DATABASE_URL_<REGION>
 * alone does not make a region servable. This router is the building block
 * for per-request regional routing; anything that adopts it gets the
 * fail-closed behaviour above.
 *
 * Usage:
 *   import { getPrismaForTenant } from '@/lib/db-router';
 *   const db = await getPrismaForTenant(tenantId);
 *   await withTenantRls(db, tenantId, async (tx) => { ... });
 */

import { PrismaClient } from '@prisma/client';
import { prisma } from '@/lib/prisma';
import {
  normalizeResidency,
  residencySessionClaim,
  servedResidencies,
  type DataResidency,
} from '@/lib/data-residency';

export type { DataResidency } from '@/lib/data-residency';

/** Thrown when a tenant's data cannot be kept in its required region. */
export class DataResidencyUnavailableError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'DataResidencyUnavailableError';
  }
}

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
  const url = process.env[REGION_ENV_VARS[region]];
  if (!url) return null;

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

// In-process cache to avoid a DB round-trip on every request. TTL is short
// (5 min) so residency changes propagate quickly without a deploy.
const CACHE_TTL_MS = 5 * 60 * 1_000;

interface CacheEntry {
  residency: unknown;
  expiry:    number;
}

const _residencyCache = new Map<string, CacheEntry>();

/**
 * Reads a tenant's stored `data_residency` from the primary DB (cached).
 * Throws on lookup failure: an unknown residency must not be treated as
 * GLOBAL. A tenant that does not exist reads as GLOBAL.
 */
async function readTenantResidency(tenantId: string): Promise<unknown> {
  const cached = _residencyCache.get(tenantId);
  if (cached && cached.expiry > Date.now()) return cached.residency;

  type Row = { data_residency: string | null };
  let rows: Row[];
  try {
    // tenants has no RLS; raw SQL avoids generated-client staleness.
    rows = await prisma.$queryRaw<Row[]>`
      SELECT data_residency FROM tenants WHERE id = ${tenantId} LIMIT 1
    `;
  } catch (err) {
    throw new DataResidencyUnavailableError(
      `Could not read data residency for tenant ${tenantId}: ${err instanceof Error ? err.message : String(err)}`,
    );
  }
  const residency = rows[0]?.data_residency ?? 'GLOBAL';
  _residencyCache.set(tenantId, { residency, expiry: Date.now() + CACHE_TTL_MS });
  return residency;
}

// ── Public API ───────────────────────────────────────────────────────────────

/**
 * Prisma client for a residency region. GLOBAL and regions this deployment
 * serves use the primary; other regions need DATABASE_URL_<REGION>.
 * Throws DataResidencyUnavailableError when the region cannot be satisfied.
 */
export function getPrismaForRegion(raw: unknown): PrismaClient {
  const region = normalizeResidency(raw);
  if (region === null) {
    throw new DataResidencyUnavailableError(`Unknown data residency value: ${String(raw)}`);
  }
  if (servedResidencies().has(region)) return prisma;

  const regional = getOrCreateRegionalClient(region as Exclude<DataResidency, 'GLOBAL'>);
  if (!regional) {
    throw new DataResidencyUnavailableError(
      `No database is configured for data residency region ${region}. Set ${REGION_ENV_VARS[region as Exclude<DataResidency, 'GLOBAL'>]} ` +
      'or serve this region from an in-region deployment (DATA_RESIDENCY_SERVED_REGIONS).',
    );
  }
  return regional;
}

/**
 * Prisma client for a tenant, based on its stored residency (whatever its
 * plan). Throws DataResidencyUnavailableError when the residency cannot be
 * determined or satisfied.
 */
export async function getPrismaForTenant(tenantId: string): Promise<PrismaClient> {
  return getPrismaForRegion(await readTenantResidency(tenantId));
}

/**
 * The `dataResidency` claim to sign into a new session for this tenant.
 * Every session issuer must spread this into signSession() so middleware can
 * refuse tenants whose region this deployment does not serve. Throws when
 * the residency cannot be read, so sign-in fails closed.
 */
export async function residencyClaimForTenant(tenantId: string): Promise<{ dataResidency?: string }> {
  return residencySessionClaim(await readTenantResidency(tenantId));
}

/**
 * Invalidate the residency cache entry for a tenant (call after provisioning
 * or after an admin changes a tenant's residency setting).
 */
export function invalidateResidencyCache(tenantId: string): void {
  _residencyCache.delete(tenantId);
}
