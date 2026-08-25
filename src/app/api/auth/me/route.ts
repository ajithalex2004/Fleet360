/**
 * GET /api/auth/me
 * Returns the current session's identity + nav permissions in one call.
 * Used by the admin layout to build a role-aware, permission-filtered sidebar.
 *
 * Response:
 * {
 *   userId, tenantId, plan, role,
 *   navPermissions: Record<navKey, boolean>,  // only relevant for TENANT_ADMIN
 *   isSuperAdmin: boolean,
 *   isReadOnly: boolean,  // true when plan=TRIAL and not fleet
 * }
 */

import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { withTenantRls } from '@/lib/rls';
import { getBranding } from '@/lib/branding';

import { requireAuthorizedTenant } from '@/lib/tenant-context';
type PermRow   = { nav_key: string; enabled: boolean };
type ModuleRow = { module: string };

export async function GET(request: NextRequest) {
  const userId        = request.headers.get('x-user-id')        ?? '';
  const tenantId      = request.headers.get('x-tenant-id')      ?? '';
  const plan          = request.headers.get('x-tenant-plan')    ?? 'TRIAL';
  const role          = request.headers.get('x-user-role')      ?? 'TENANT_ADMIN';
  const impersonatedBy = request.headers.get('x-impersonated-by') ?? '';

  if (!userId || !tenantId) {
    return NextResponse.json(
      { error: 'Not authenticated' },
      { status: 401, headers: { 'Cache-Control': 'private, no-store' } },
    );
  }

  const isSuperAdmin = role === 'SUPER_ADMIN';

  // Fetch nav permissions + enabled modules + branding in parallel.
  //
  // Scoped with withTenantRls: tenant_admin_nav_permissions, tenant_modules
  // and tenants are all RLS-protected. Unscoped, every one of these returns
  // zero rows once the app connects as a role that doesn't bypass RLS — and
  // because each has a .catch() fallback below, the failure is SILENT: the
  // user simply loads with no nav permissions, no modules and a blank tenant
  // name, rather than seeing an error.
  const [navPermissions, enabledModules, tenantName, branding] = await withTenantRls(
    prisma,
    tenantId,
    async (tx) => Promise.all([
    // 1. Nav permissions (admin sidebar toggles)
    isSuperAdmin
      ? Promise.resolve({} as Record<string, boolean>)
      : tx.$queryRawUnsafe<PermRow[]>(
          `SELECT nav_key, enabled FROM tenant_admin_nav_permissions WHERE tenant_id = $1`,
          tenantId,
        ).then(rows => {
          const obj: Record<string, boolean> = {};
          for (const r of rows) obj[r.nav_key] = r.enabled;
          return obj;
        }).catch(() => ({} as Record<string, boolean>)),

    // 2. Enabled modules for this tenant (used to filter platform landing page)
    isSuperAdmin
      ? Promise.resolve([] as string[])   // SUPER_ADMIN sees all — return empty = no restriction
      : tx.$queryRawUnsafe<ModuleRow[]>(
          `SELECT module FROM tenant_modules WHERE tenant_id = $1 AND is_enabled = true`,
          tenantId,
        ).then(rows => rows.map(r => r.module))
        .catch(() => [] as string[]),

    // 3. Tenant display name
    tx.$queryRawUnsafe<{ name: string }[]>(
      `SELECT name FROM tenants WHERE id = $1 LIMIT 1`,
      tenantId,
    ).then(rows => rows[0]?.name ?? '').catch(() => ''),

    // 4. White-label branding (best-effort). Uses its own client rather than
    //    tx, so it is not covered by this scope — see note in the PR.
    getBranding(tenantId).catch(() => null),
    ]),
  );

  return NextResponse.json(
    {
      userId,
      tenantId,
      tenantName,
      plan,
      role,
      isSuperAdmin,
      navPermissions,
      enabledModules, // [] means "no restriction" for SUPER_ADMIN; non-empty = explicit whitelist
      impersonatedBy: impersonatedBy || null,
      branding,
    },
    {
      headers: {
        'Cache-Control': 'private, no-store',
      },
    }
  );
}
