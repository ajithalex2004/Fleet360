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

type PermRow   = { nav_key: string; enabled: boolean };
type ModuleRow = { module: string };

export async function GET(request: NextRequest) {
  const userId        = request.headers.get('x-user-id')        ?? '';
  const tenantId      = request.headers.get('x-tenant-id')      ?? '';
  const plan          = request.headers.get('x-tenant-plan')    ?? 'TRIAL';
  const role          = request.headers.get('x-user-role')      ?? 'TENANT_ADMIN';
  const impersonatedBy = request.headers.get('x-impersonated-by') ?? '';

  if (!userId || !tenantId) {
    return NextResponse.json({ error: 'Not authenticated' }, { status: 401 });
  }

  const isSuperAdmin = role === 'SUPER_ADMIN';

  // Fetch nav permissions + enabled modules in parallel
  const [navPermissions, enabledModules, tenantName] = await Promise.all([
    // 1. Nav permissions (admin sidebar toggles)
    isSuperAdmin
      ? Promise.resolve({} as Record<string, boolean>)
      : prisma.$queryRawUnsafe<PermRow[]>(
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
      : prisma.$queryRawUnsafe<ModuleRow[]>(
          `SELECT module FROM tenant_modules WHERE tenant_id = $1 AND is_enabled = true`,
          tenantId,
        ).then(rows => rows.map(r => r.module))
        .catch(() => [] as string[]),

    // 3. Tenant display name
    prisma.$queryRawUnsafe<{ name: string }[]>(
      `SELECT name FROM tenants WHERE id = $1 LIMIT 1`,
      tenantId,
    ).then(rows => rows[0]?.name ?? '').catch(() => ''),
  ]);

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
    },
    {
      headers: {
        // Browser caches this response for 60 s and serves stale for 120 s while
        // revalidating in background. Marked private so CDNs don't share across users.
        'Cache-Control': 'private, max-age=60, stale-while-revalidate=120',
      },
    }
  );
}
