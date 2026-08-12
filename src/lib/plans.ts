/**
 * Canonical plan reader.
 *
 * The DB (platform_plans table) is the source of truth for plan tiers —
 * prices, descriptions, quotas, feature gates, and tier ordering. The
 * `sort_order` column is the rank: higher = higher tier. This used to
 * be hardcoded in plan-limits.ts and three other places; this module
 * is the single read path.
 *
 * Read path is sync via a module-level cache (30 s TTL). Writes go
 * through the admin API which calls `invalidatePlanCache()` after
 * any mutation. The cache populates lazily on first access; if the
 * DB read fails, we keep the previous cache (or empty) and fall back
 * to the hardcoded `FALLBACK_LIMITS` so the system stays usable.
 *
 * Pairs with:
 *   - prisma/migrations/20260803195000_create_platform_plans/
 *   - /api/platform/plans         (public catalog for onboarding)
 *   - /api/admin/platform/plans   (SUPER_ADMIN CRUD)
 *   - src/app/(app)/admin/platform-plans/  (admin UI)
 */

import { prisma } from '@/lib/prisma';

// ── Public types ────────────────────────────────────────────────────────────

export interface PlanLimits {
  maxUsers:               number;
  maxVehicles:            number;
  maxBookingsPerMonth:    number;
  /** Module codes that are locked behind this plan (gated, not just limited). */
  premiumModules:         readonly string[];
  sso:                    boolean;
  apiKeys:                boolean;
  branding:               boolean;
}

export interface PlanCatalogEntry {
  code:        string;
  name:        string;
  priceLabel:  string;
  description: string;
  highlight:   boolean;
  sortOrder:   number;
  isActive:    boolean;
  limits:      PlanLimits;
}

// ── Cache ───────────────────────────────────────────────────────────────────

const TTL_MS = 30_000;

let _cache: Map<string, PlanCatalogEntry> | null = null;
let _cacheAt = 0;
let _loading: Promise<void> | null = null;

interface PlanRow {
  code:                string;
  name:                string;
  price_label:         string;
  description:         string;
  highlight:           boolean;
  sort_order:          number;
  max_users:           number;
  max_vehicles:        number;
  max_bookings_per_month: number;
  premium_modules:     string[] | null;
  sso_enabled:         boolean;
  api_keys_enabled:    boolean;
  branding_enabled:    boolean;
  is_active:           boolean;
}

async function loadFromDb(): Promise<Map<string, PlanCatalogEntry>> {
  const rows = await prisma.$queryRawUnsafe<PlanRow[]>(
    `SELECT code, name, price_label, description, highlight, sort_order,
            max_users, max_vehicles, max_bookings_per_month,
            premium_modules, sso_enabled, api_keys_enabled, branding_enabled,
            is_active
     FROM platform_plans`,
  );
  const map = new Map<string, PlanCatalogEntry>();
  for (const r of rows) {
    map.set(r.code, {
      code:        r.code,
      name:        r.name,
      priceLabel:  r.price_label,
      description: r.description,
      highlight:   r.highlight,
      sortOrder:   r.sort_order,
      isActive:    r.is_active,
      limits: {
        maxUsers:              r.max_users,
        maxVehicles:           r.max_vehicles,
        maxBookingsPerMonth:   r.max_bookings_per_month,
        premiumModules:        r.premium_modules ?? [],
        sso:                   r.sso_enabled,
        apiKeys:               r.api_keys_enabled,
        branding:              r.branding_enabled,
      },
    });
  }
  return map;
}

async function ensureLoaded(): Promise<Map<string, PlanCatalogEntry>> {
  const now = Date.now();
  if (_cache && now - _cacheAt < TTL_MS) return _cache;
  if (_loading) { await _loading; return _cache ?? new Map(); }
  _loading = (async () => {
    try {
      _cache = await loadFromDb();
      _cacheAt = Date.now();
    } catch (e) {
      console.error('[plans] cache load failed, keeping previous:', e);
      _cache = _cache ?? new Map();
    } finally {
      _loading = null;
    }
  })();
  await _loading;
  return _cache!;
}

// Eager load at module import — best effort, non-blocking.
void ensureLoaded().catch(() => { /* logged inside */ });

// ── Fallback (used only when DB read fails AND no cached data exists) ──────
// Mirrors the seeded data. If the DB is up, these never get used.
const FALLBACK_LIMITS: Record<string, PlanLimits> = {
  TRIAL:        { maxUsers: 5,    maxVehicles: 10,    maxBookingsPerMonth: 200,        premiumModules: [], sso: false, apiKeys: false, branding: false },
  STANDARD:     { maxUsers: 25,   maxVehicles: 100,   maxBookingsPerMonth: 5_000,      premiumModules: [], sso: false, apiKeys: true,  branding: false },
  PROFESSIONAL: { maxUsers: 200,  maxVehicles: 1_000, maxBookingsPerMonth: 50_000,     premiumModules: [], sso: true,  apiKeys: true,  branding: true  },
  ENTERPRISE:   { maxUsers: Number.POSITIVE_INFINITY, maxVehicles: Number.POSITIVE_INFINITY, maxBookingsPerMonth: Number.POSITIVE_INFINITY, premiumModules: [], sso: true, apiKeys: true, branding: true },
};
const FALLBACK_RANK: Record<string, number> = { TRIAL: 0, STANDARD: 1, PROFESSIONAL: 2, ENTERPRISE: 3 };

// ── Public sync getters (cached) ───────────────────────────────────────────

/**
 * Get the limits for a plan. Uses the cache. Falls back to TRIAL on unknown
 * codes so a typo never crashes a hot path. Returns Number.POSITIVE_INFINITY
 * on ENTERPRISE quotas (the sentinel in plan-limits.ts).
 */
export function getLimits(plan: string): PlanLimits {
  const entry = _cache?.get(plan);
  if (entry) return entry.limits;
  return FALLBACK_LIMITS[plan] ?? FALLBACK_LIMITS.TRIAL;
}

/** Get a full plan entry by code. Null if the code is unknown. */
export function getPlan(code: string): PlanCatalogEntry | null {
  return _cache?.get(code) ?? null;
}

/**
 * Compare plan ranks using sort_order from the DB. Higher sort_order = higher
 * tier. Falls back to the literal TRIAL < STANDARD < PROFESSIONAL < ENTERPRISE
 * if a code isn't in the cache (e.g. immediately after process start).
 */
export function planAtLeast(actual: string, minimum: string): boolean {
  if (_cache?.has(actual) && _cache?.has(minimum)) {
    return (_cache.get(actual)!.sortOrder) >= (_cache.get(minimum)!.sortOrder);
  }
  return (FALLBACK_RANK[actual] ?? 0) >= (FALLBACK_RANK[minimum] ?? 0);
}

// ── Public async API (forces a fresh load if cache is stale) ───────────────

/**
 * List all plans, sorted by sort_order. Use `activeOnly` for the onboarding
 * page (don't show soft-deleted plans to new tenants).
 */
export async function listPlans(opts: { activeOnly?: boolean } = {}): Promise<PlanCatalogEntry[]> {
  const cache = await ensureLoaded();
  const all = Array.from(cache.values());
  return (opts.activeOnly ? all.filter(p => p.isActive) : all)
    .sort((a, b) => a.sortOrder - b.sortOrder);
}

/**
 * Drop the cache. The admin write route calls this after every mutation so
 * the next read picks up the new state immediately (no waiting for TTL).
 */
export function invalidatePlanCache(): void {
  _cache = null;
  _cacheAt = 0;
  // Kick off a reload in the background so the next sync getLimits() has data.
  void ensureLoaded().catch(() => { /* logged inside */ });
}
