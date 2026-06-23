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
import { getBranding } from '@/lib/branding';
import { getAdminPolicy } from '@/lib/admin-policy';
import { isSessionRevoked, touchSession } from '@/lib/session-registry';
import { customerContextForUser } from '@/lib/corporate-customer-identity';

type PermRow   = { nav_key: string; enabled: boolean };
type ModuleRow = { module: string };

const ME_CACHE_TTL_MS = 60_000;
const meCache = new Map<string, { ts: number; body: unknown }>();

export async function GET(request: NextRequest) {
  const userId        = request.headers.get('x-user-id')        ?? '';
  const tenantId      = request.headers.get('x-tenant-id')      ?? '';
  const plan          = request.headers.get('x-tenant-plan')    ?? 'TRIAL';
  const role          = request.headers.get('x-user-role')      ?? 'TENANT_ADMIN';
  const impersonatedBy = request.headers.get('x-impersonated-by') ?? '';
  const sessionId = request.headers.get('x-session-id') ?? '';
  const sessionCustomerId = request.headers.get('x-customer-id') ?? '';
  const sessionCustomerRole = request.headers.get('x-customer-role') ?? '';

  if (!userId || !tenantId) {
    return NextResponse.json({ error: 'Not authenticated' }, { status: 401 });
  }

  if (sessionId && await isSessionRevoked(sessionId)) {
    return NextResponse.json(
      { error: 'Unauthorized', message: 'Session has been revoked' },
      { status: 401 },
    );
  }
  await touchSession(
    sessionId,
    request.headers.get('x-forwarded-for')?.split(',')[0]?.trim() ?? request.headers.get('x-real-ip'),
    request.headers.get('user-agent'),
  );

  const cacheKey = `${userId}:${tenantId}:${role}:${impersonatedBy}:${sessionId}`;
  const cached = meCache.get(cacheKey);
  if (cached && Date.now() - cached.ts < ME_CACHE_TTL_MS) {
    return NextResponse.json(cached.body, {
      headers: {
        'Cache-Control': 'private, max-age=60, stale-while-revalidate=120',
        'X-Fleet360-Cache': 'hit',
      },
    });
  }

  const isSuperAdmin = role === 'SUPER_ADMIN';
  const isAdmin = role === 'SUPER_ADMIN' || role === 'TENANT_ADMIN';
  const adminCtx = {
    userId,
    tenantId,
    role,
    isSuperAdmin,
    isTenantAdmin: role === 'TENANT_ADMIN',
  };

  // Fetch nav permissions + enabled modules + branding in parallel
  const [legacyNavPermissions, enabledModules, tenantName, branding, adminPolicy, customerContext] = await Promise.all([
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

    // 4. White-label branding (best-effort)
    getBranding(tenantId).catch(() => null),

    isAdmin ? getAdminPolicy(adminCtx).catch(() => null) : Promise.resolve(null),
    sessionCustomerId
      ? Promise.resolve({
          tenantId,
          customerId: sessionCustomerId,
          customerName: '',
          domain: '',
          role: sessionCustomerRole || 'CUSTOMER_USER',
        })
      : customerContextForUser(tenantId, userId).catch(() => null),
  ]);

  const navPermissions = adminPolicy?.nav ?? legacyNavPermissions;

  const body = {
      userId,
      tenantId,
      tenantName,
      plan,
      role,
      isAdmin,
      isSuperAdmin,
      adminPermissions: adminPolicy?.permissions ?? [],
      navPermissions,
      enabledModules, // [] means "no restriction" for SUPER_ADMIN; non-empty = explicit whitelist
      customerContext,
      impersonatedBy: impersonatedBy || null,
      branding,
    };
  meCache.set(cacheKey, { ts: Date.now(), body });

  return NextResponse.json(
    body,
    {
      headers: {
        // Browser caches this response for 60 s and serves stale for 120 s while
        // revalidating in background. Marked private so CDNs don't share across users.
        'Cache-Control': 'private, max-age=60, stale-while-revalidate=120',
      },
    }
  );
}
