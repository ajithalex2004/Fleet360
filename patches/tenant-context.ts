/**
 * Tenant Context Utilities — Smart Mobility SaaS Platform
 * Provides tenant scoping helpers for multi-tenant SQL queries.
 */

// import { ACCOUNT_CODE_PREFIXES, type AccountPrefixGroup } from './modules';

// ── Types ────────────────────────────────────────────────────────────────────

export interface TenantContext {
  tenantId: string | null;
  isPlatformAdmin: boolean;
  activeModules: string[];
  moduleFilter: string; // SQL fragment like "AND module_source IN ('RAC','SCHOOL_BUS')"
}

// ── Constants ─────────────────────────────────────────────────────────────────

/**
 * Maps CoA account-code groups to their income + direct-cost prefixes.
 * Sourced from the canonical module registry (@/lib/modules) so adding
 * a financial module requires editing one file.
 *
 *   RAC             → income 4100 + direct costs 5110, 5120
 *   SCHOOL_BUS      → income 4400 + direct cost 5140
 *   LOGISTICS       → income 4300 + direct cost 5130
 *   LEASING         → income 4200 + direct cost 5115
 *   STAFF_TRANSPORT → income 4500 + direct cost 5145
 *   AMBULANCE       → income 4600 + direct cost 5160
 */
// TODO: modules file missing - commented out for now
// export const MODULE_ACCOUNT_PREFIXES: Record<AccountPrefixGroup, readonly string[]> = ACCOUNT_CODE_PREFIXES;

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
  const set = new Set(modules.map(m => m.toUpperCase()));
  const allModules = set.size === 0; // empty = no filter = all modules

  return {
    racEnabled:           allModules || set.has('RAC'),
    schoolBusEnabled:     allModules || set.has('SCHOOL_BUS'),
    logisticsEnabled:     allModules || set.has('LOGISTICS'),
    leasingEnabled:       allModules || set.has('LEASING'),
    staffTransportEnabled: allModules || set.has('STAFF_TRANSPORT'),
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
  prisma: { $queryRawUnsafe: (...args: unknown[]) => Promise<unknown[]> }
): Promise<string[]> {
  const rows = await (prisma.$queryRawUnsafe as (sql: string, ...params: unknown[]) => Promise<{ module_code: string }[]>)(
    `SELECT module_code FROM tenant_modules WHERE tenant_id = $1 AND status = 'ACTIVE'`,
    sanitizeTenantId(tenantId)
  ).catch(() => [] as { module_code: string }[]);

  return rows.map(r => r.module_code);
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


// ── TENANT-001 hardened identity resolution ─────────────────────────────────
//
// x-tenant-id is a *selector*, not proof of identity.
// Middleware injects x-tenant-id from the verified session (session.tenantId).
// Handlers must:
//   1. Prefer session-derived headers set by middleware (x-tenant-id + x-user-id)
//   2. Never accept tenantId from the request body as ownership authority
//   3. For SUPER_ADMIN tenant-switch flows, optionally assert membership
//   4. Fail closed when tenant context is absent

export type AuthorizedTenantResult =
  | { ok: true; tenantId: string; userId: string | null; role: string | null }
  | { ok: false; status: 400 | 401 | 403; error: string };

/**
 * Resolve the authorized tenant for a protected API request.
 *
 * Identity chain:
 *   Session (middleware) → x-tenant-id / x-user-id / role headers
 *   → optional membership check when a switcher header is present
 *   → TenantContext
 *
 * Client-supplied body.tenantId is intentionally ignored.
 */

function headerGet(
  headers: Headers | Record<string, string | null | undefined> | { get: (k: string) => string | null },
  name: string,
): string {
  if (!headers) return '';
  if (typeof (headers as { get?: (k: string) => string | null }).get === 'function') {
    return ((headers as { get: (k: string) => string | null }).get(name) ?? '') as string;
  }
  const rec = headers as Record<string, string | null | undefined>;
  const key = Object.keys(rec).find((k) => k.toLowerCase() === name.toLowerCase());
  return (key ? rec[key] : '') ?? '';
}

export function resolveAuthorizedTenant(
  req: {
    headers: Headers;
    nextUrl?: { searchParams: URLSearchParams };
  },
  opts: {
    /** When true, SUPER_ADMIN may select another tenant via header/query. */
    allowPlatformSwitch?: boolean;
    /** Optional membership predicate for switcher flows. */
    assertMembership?: (userId: string, tenantId: string) => Promise<boolean> | boolean;
  } = {},
): AuthorizedTenantResult {
  const userId = headerGet(req.headers as any, 'x-user-id') || null;
  const role = headerGet(req.headers as any, 'x-user-role') || headerGet(req.headers as any, 'x-role') || null;
  const sessionTenant = sanitizeTenantId(headerGet(req.headers as any, 'x-tenant-id'));

  if (!sessionTenant) {
    // Authenticated routes should have middleware-injected tenant.
    // Missing context = fail closed (never unscoped query).
    if (!userId) {
      return { ok: false, status: 401, error: 'Authentication required' };
    }
    return { ok: false, status: 403, error: 'Tenant context required' };
  }

  // Optional switcher: only SUPER_ADMIN, and only when explicitly allowed.
  const sp = req.nextUrl?.searchParams as { get?: (k: string) => string | null } | undefined;
  const requested =
    sanitizeTenantId(sp?.get?.('tenantId') ?? '') ||
    sanitizeTenantId(headerGet(req.headers as any, 'x-requested-tenant-id'));

  if (requested && requested !== sessionTenant) {
    if (!opts.allowPlatformSwitch || role !== 'SUPER_ADMIN') {
      return { ok: false, status: 403, error: 'Tenant switch not permitted' };
    }
    // Membership assertion is required when a switch is requested.
    // Callers that pass assertMembership will be checked asynchronously
    // via resolveAuthorizedTenantAsync.
    return {
      ok: true,
      tenantId: requested,
      userId: userId || null,
      role: role || null,
    };
  }

  return {
    ok: true,
    tenantId: sessionTenant,
    userId: userId || null,
    role: role || null,
  };
}

/**
 * Async variant that enforces membership when SUPER_ADMIN switches tenant.
 */
export async function resolveAuthorizedTenantAsync(
  req: {
    headers: Headers;
    nextUrl?: { searchParams: URLSearchParams };
  },
  opts: {
    allowPlatformSwitch?: boolean;
    assertMembership?: (userId: string, tenantId: string) => Promise<boolean> | boolean;
  } = {},
): Promise<AuthorizedTenantResult> {
  const result = resolveAuthorizedTenant(req, opts);
  if (!result.ok) return result;

  const sessionTenant = sanitizeTenantId(headerGet(req.headers as any, 'x-tenant-id'));
  if (result.tenantId !== sessionTenant && opts.assertMembership) {
    if (!result.userId) {
      return { ok: false, status: 403, error: 'Tenant switch requires authenticated user' };
    }
    const allowed = await opts.assertMembership(result.userId, result.tenantId);
    if (!allowed) {
      return { ok: false, status: 403, error: 'User is not a member of the requested tenant' };
    }
  }
  return result;
}

/**
 * Require an authorized tenant or return a NextResponse-compatible error shape.
 * Use in route handlers:
 *
 *   const authz = requireAuthorizedTenant(req);
 *   if (!authz.ok) return NextResponse.json({ error: authz.error }, { status: authz.status });
 *   const { tenantId } = authz;
 */
export function requireAuthorizedTenant(
  req: {
    headers: Headers;
    nextUrl?: { searchParams: URLSearchParams };
  },
  opts?: {
    allowPlatformSwitch?: boolean;
  },
): AuthorizedTenantResult {
  return resolveAuthorizedTenant(req, opts);
}

/**
 * Strip tenant ownership fields from untrusted request bodies.
 * Tenant ownership must come from context, never from normal business input.
 */
export function stripTenantOwnershipFields<T extends Record<string, unknown>>(
  body: T,
): Omit<T, 'tenantId' | 'tenant_id'> {
  const { tenantId: _a, tenant_id: _b, ...rest } = body as T & {
    tenantId?: unknown;
    tenant_id?: unknown;
  };
  return rest;
}
