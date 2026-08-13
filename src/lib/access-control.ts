/**
 * Access control utilities — role + plan based permissions.
 *
 * This file used to maintain its own parallel taxonomy of 10 module keys
 * (e.g. `'rac'`, `'ambulance'`, `'staff'`) that drifted from the canonical
 * module registry in `@/lib/modules`. That third taxonomy is gone. The
 * `AppModule` type is now derived from the registry, and `moduleFromPath()`
 * is a registry-driven lookup — no more hand-maintained `if (pathname.startsWith(...))`
 * ladder.
 *
 * Rules:
 *   - SUPER_ADMIN: full access to everything
 *   - TENANT_ADMIN on TRIAL plan: read-only everywhere EXCEPT modules in TRIAL_FREE_MODULES
 *   - TENANT_ADMIN on paid plan: full write access to their tenant's data
 *
 * Special: `'admin'` is in AppModule but NOT in MODULES — it's a
 * platform-level route gate that spans tenants (no per-tenant subscription,
 * no single landing page, no card). Its path prefixes live below as
 * ADMIN_PATH_PREFIXES.
 */

import type { ModuleKey } from '@/lib/modules';
import { MODULES } from '@/lib/modules';
import { NextRequest, NextResponse } from 'next/server';

// ── Types ───────────────────────────────────────────────────────────────────

/**
 * AppModule = every canonical tenant module + the platform-level `'admin'`
 * gate. Derived from ModuleKey so the type tracks the registry automatically:
 * adding an entry to MODULES in `@/lib/modules` immediately widens AppModule.
 *
 * Use this for any function that needs to gate by module. Prefer canonical
 * kebab-case keys (e.g. `'rental'`, `'incidents'`, `'bus-ops'`); the legacy
 * aliases (`'rac'`, `'ambulance'`, `'staff'`) are no longer accepted at the
 * type level. Old data in DB / forms still works via `resolveModuleKey()` in
 * `@/lib/modules`.
 */
export type AppModule = ModuleKey | 'admin';

// ── Trial plan allowlist ────────────────────────────────────────────────────

/**
 * Modules writable on the Free Trial plan. Everything else is read-only
 * for TRIAL tenants. SUPERA_ADMIN and paid plans are unaffected.
 *
 * Typed as `as const satisfies readonly ModuleKey[]` so:
 *   - `'fleet'` is verified to be a real ModuleKey at compile time
 *   - the array keeps its narrow tuple type for `.includes()` ergonomics
 *   - widening AppModule to add a new key won't silently break the allowlist
 */
export const TRIAL_FREE_MODULES = ['fleet'] as const satisfies readonly ModuleKey[];

/**
 * Returns true if the user can perform write operations (POST/PUT/PATCH/DELETE)
 * for the given module based on their plan and role.
 */
export function canWrite(plan: string, role: string, module: AppModule): boolean {
  if (role === 'SUPER_ADMIN') return true;
  if (plan !== 'TRIAL') return true;
  // Trial plan: only TRIAL_FREE_MODULES are writable.
  // Cast widens the tuple type so `.includes()` accepts the full AppModule union.
  return (TRIAL_FREE_MODULES as readonly AppModule[]).includes(module);
}

// ── Path → module resolution ────────────────────────────────────────────────

/**
 * Platform-level path prefixes for the `'admin'` gate. Lives in this file
 * (not in MODULES) because `'admin'` is not a tenant module — it's a
 * cross-tenant control surface.
 */
const ADMIN_PATH_PREFIXES: readonly string[] = ['/admin', '/api/admin'];

/**
 * Test whether a pathname matches a prefix exactly or as a parent path.
 * `/api/finance` matches `/api/finance` and `/api/finance/invoices`, but
 * NOT `/api/finance-archive` (the `/` boundary prevents false positives).
 */
function matchesPrefix(pathname: string, prefix: string): boolean {
  return pathname === prefix || pathname.startsWith(prefix + '/');
}

/**
 * Derives the module from an API or page pathname via a registry-driven
 * lookup. Returns null if the pathname doesn't belong to a registered
 * tenant module or the platform-level admin gate.
 *
 * Source of truth: `apiPathPrefixes` on each `ModuleDef` in
 * `@/lib/modules`, plus the platform-level `ADMIN_PATH_PREFIXES` above.
 * Adding a new module's API routes is now a registry edit, not a code
 * edit in this file.
 *
 * Note: only modules that declare `apiPathPrefixes` are matchable. Modules
 * without API surface (pure UI / overview modules) intentionally return null
 * here — they don't need write-gating.
 */
export function moduleFromPath(pathname: string): AppModule | null {
  // Platform-level admin gate first — checked before the module loop because
  // /admin paths are NOT tenant modules and must not be matched by anything
  // in MODULES.
  if (ADMIN_PATH_PREFIXES.some((p) => matchesPrefix(pathname, p))) {
    return 'admin';
  }
  for (const m of MODULES) {
    if (!m.apiPathPrefixes) continue;
    for (const prefix of m.apiPathPrefixes) {
      if (matchesPrefix(pathname, prefix)) return m.key;
    }
  }
  return null;
}

// ── Route handler guard ─────────────────────────────────────────────────────

/**
 * Guard for use in API route handlers.
 * Call at the top of any write handler (POST/PUT/PATCH/DELETE).
 *
 * Usage:
 *   import { assertCanWrite, moduleFromPath } from '@/lib/access-control';
 *
 *   export async function POST(req: NextRequest) {
 *     const mod = moduleFromPath(req.nextUrl.pathname);
 *     const guard = mod ? assertCanWrite(req, mod) : null;
 *     if (guard) return guard; // returns 403 NextResponse
 *     // ... handler body
 *   }
 *
 * Or, if the module is known statically:
 *
 *   const guard = assertCanWrite(req, 'finance');
 *   if (guard) return guard;
 */
export function assertCanWrite(
  request: NextRequest,
  module: AppModule,
): NextResponse | null {
  const plan = request.headers.get('x-tenant-plan') ?? 'TRIAL';
  const role = request.headers.get('x-user-role')   ?? 'TENANT_ADMIN';

  if (canWrite(plan, role, module)) return null; // allowed

  return NextResponse.json(
    {
      error:   'Forbidden',
      message: `Your Free Trial plan is read-only for the ${module} module. Upgrade your plan to enable this action.`,
      code:    'TRIAL_READ_ONLY',
    },
    { status: 403 },
  );
}
