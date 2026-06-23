/**
 * Tenant Context Utilities — Smart Mobility SaaS Platform
 * Provides tenant scoping helpers for multi-tenant SQL queries.
 */

import { normalizeModuleKey } from './module-access-presets';

// ── Types ────────────────────────────────────────────────────────────────────

export interface TenantContext {
  tenantId: string | null;
  isPlatformAdmin: boolean;
  activeModules: string[];
  moduleFilter: string; // SQL fragment like "AND module_source IN ('RAC','SCHOOL_BUS')"
}

// ── Constants ─────────────────────────────────────────────────────────────────

/**
 * Maps module codes to Chart-of-Accounts account code prefixes.
 * RAC       → income 4100 + direct costs 5110, 5120
 * SCHOOL_BUS → income 4400 + direct cost 5140
 */
export const MODULE_ACCOUNT_PREFIXES: Record<string, string[]> = {
  RAC:             ['4100', '5110', '5120'],
  SCHOOL_BUS:      ['4400', '5140'],
  LOGISTICS:       ['4300', '5130'],
  LEASING:         ['4200', '5115'],
  STAFF_TRANSPORT: ['4500', '5145'],
  AMBULANCE:       ['4600', '5160'],
};

// ── Tenant ID Resolution ──────────────────────────────────────────────────────

/**
 * Resolves tenant_id from a request's query params or headers.
 * Priority: ?tenantId param > X-Tenant-Id header > null (platform context)
 */
export function getTenantId(
  req: { nextUrl?: { searchParams: URLSearchParams }; headers: Headers }
): string | null {
  const fromQuery = req.nextUrl?.searchParams?.get('tenantId') ?? null;
  if (fromQuery) return sanitizeTenantId(fromQuery);

  const fromHeader = req.headers.get('X-Tenant-Id');
  if (fromHeader) return sanitizeTenantId(fromHeader);

  return null;
}

/**
 * Strips anything that isn't alphanumeric, hyphens, or underscores
 * to prevent SQL injection via tenant IDs.
 */
function sanitizeTenantId(id: string): string {
  return id.replace(/[^a-zA-Z0-9_-]/g, '');
}

// ── WHERE Clause Builder ──────────────────────────────────────────────────────

/**
 * Builds a SQL WHERE clause fragment for tenant scoping.
 *
 * If tenantId is null  → returns { clause: '', param: null }  (no filter = platform sees all)
 * If tenantId is a string → returns { clause: ` AND tenant_id = $N`, param: tenantId }
 *
 * @param tenantId   - The resolved tenant ID (or null for platform admin)
 * @param paramIndex - The $N placeholder index to use (default: 1)
 */
export function tenantWhereClause(
  tenantId: string | null,
  paramIndex: number = 1
): { clause: string; param: string | null } {
  if (!tenantId) return { clause: '', param: null };
  return {
    clause: ` AND tenant_id = $${paramIndex}`,
    param: sanitizeTenantId(tenantId),
  };
}

// ── Module Filter ─────────────────────────────────────────────────────────────

/**
 * Given an array of module codes, returns booleans for each known module
 * and a flag indicating whether all modules are active.
 *
 * @param modules - e.g. ['RAC', 'SCHOOL_BUS']
 */
export function moduleAccountFilter(modules: string[]): {
  racEnabled: boolean;
  schoolBusEnabled: boolean;
  logisticsEnabled: boolean;
  leasingEnabled: boolean;
  staffTransportEnabled: boolean;
  ambulanceEnabled: boolean;
  allModules: boolean;
} {
  const set = new Set(modules.map(m => normalizeModuleKey(m).toUpperCase()));
  const allModules = set.size === 0; // empty = no filter = all modules

  return {
    racEnabled:           allModules || set.has('RAC'),
    schoolBusEnabled:     allModules || set.has('SCHOOL_BUS'),
    logisticsEnabled:     allModules || set.has('LOGISTICS'),
    leasingEnabled:       allModules || set.has('LEASING'),
    staffTransportEnabled: allModules || set.has('BUS_OPS') || set.has('STAFF_TRANSPORT'),
    ambulanceEnabled:     allModules || set.has('AMBULANCE'),
    allModules,
  };
}

// ── Active Modules Lookup ────────────────────────────────────────────────────

/**
 * Given a tenantId, returns which modules are active for that tenant.
 * Queries the tenant_modules table.
 */
export async function getTenantActiveModules(
  tenantId: string,
  prisma: { $queryRawUnsafe: (query: string, ...values: unknown[]) => unknown }
): Promise<string[]> {
  const rows = await (prisma.$queryRawUnsafe as (sql: string, ...params: unknown[]) => Promise<{ module: string }[]>)(
    `SELECT module FROM tenant_modules WHERE tenant_id = $1 AND COALESCE(is_enabled, true) = true`,
    sanitizeTenantId(tenantId)
  ).catch(() => [] as { module: string }[]);

  return rows.map(r => normalizeModuleKey(r.module));
}

// ── Build Full TenantContext ──────────────────────────────────────────────────

/**
 * Assembles a complete TenantContext from a request.
 * Does NOT hit the DB (use getTenantActiveModules separately when needed).
 */
export function buildTenantContext(
  tenantId: string | null,
  activeModules: string[] = [],
  isPlatformAdmin: boolean = tenantId === null
): TenantContext {
  const moduleFilter =
    activeModules.length > 0
      ? `AND module_source IN (${activeModules.map(m => `'${m}'`).join(',')})`
      : '';

  return {
    tenantId,
    isPlatformAdmin,
    activeModules,
    moduleFilter,
  };
}
