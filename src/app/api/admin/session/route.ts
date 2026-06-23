import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { moduleAccessPermissionKeys } from '@/lib/module-access-presets';
import { verifySession } from '@/lib/tenant-session';

const SESSION_CACHE_TTL_MS = 60_000;
const sessionCache = new Map<string, { ts: number; body: unknown }>();

export async function GET(req: NextRequest) {
  try {
    let sessionUserId = req.headers.get('x-user-id') ?? '';
    let sessionTenantId = req.headers.get('x-tenant-id') ?? '';
    let sessionRole = req.headers.get('x-user-role') ?? '';

    // This route is listed in the middleware's PUBLIC prefixes, which means
    // the middleware passes it through WITHOUT injecting the x-user-id /
    // x-tenant-id headers. Without a fallback the header check below always
    // fails → 401 → PermissionContext deletes the session → the user is
    // logged out the moment they open a ModuleGuard-protected module
    // (e.g. Logistics). Verify the session cookie directly so the route
    // authenticates regardless of whether middleware injected headers.
    if (!sessionUserId || !sessionTenantId) {
      const token = req.cookies.get('xl-session')?.value;
      const session = token ? await verifySession(token) : null;
      if (session) {
        sessionUserId = session.userId;
        sessionTenantId = session.tenantId;
        sessionRole = session.role ?? sessionRole;
      }
    }

    if (!sessionUserId || !sessionTenantId) {
      return NextResponse.json({ error: 'Not authenticated' }, { status: 401 });
    }

    const { searchParams } = new URL(req.url);
    const userId   = searchParams.get('userId') ?? sessionUserId;
    const tenantId = searchParams.get('tenantId') ?? sessionTenantId;
    if (!userId || !tenantId) return NextResponse.json({ error: 'userId and tenantId required' }, { status: 400 });

    const isSuperAdmin = sessionRole === 'SUPER_ADMIN';
    if (!isSuperAdmin && (userId !== sessionUserId || tenantId !== sessionTenantId)) {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
    }

    const cacheKey = `${userId}:${tenantId}:${sessionRole}`;
    const cached = sessionCache.get(cacheKey);
    if (cached && Date.now() - cached.ts < SESSION_CACHE_TTL_MS) {
      return NextResponse.json(cached.body, {
        headers: {
          'Cache-Control': 'private, max-age=60, stale-while-revalidate=120',
          'X-Fleet360-Cache': 'hit',
        },
      });
    }

    // Get user
    const user = await prisma.user.findUnique({ where: { id: userId } });
    if (!user) return NextResponse.json({ error: 'User not found' }, { status: 404 });

    // Get user-tenant assignment with role
    const userTenant = await prisma.userTenant.findUnique({
      where: { userId_tenantId: { userId, tenantId } },
      include: {
        role: { include: { permissions: { include: { permission: true } } } },
        tenant: { include: { modules: { where: { isEnabled: true } } } },
      },
    });
    if (!userTenant || !userTenant.isActive) {
      return NextResponse.json({ error: 'User has no active access to this tenant' }, { status: 403 });
    }

    // Build permission strings
    const permStrings: string[] = userTenant.role.permissions.map(rp =>
      `${rp.permission.module}:${rp.permission.action}:${rp.permission.resource ?? '*'}`
    );
    permStrings.push(...moduleAccessPermissionKeys(user.moduleAccess));

    // SUPER_ADMIN gets wildcard
    if (userTenant.role.code === 'SUPER_ADMIN') permStrings.push('*:*:*');

    const body = {
        user: {
          id: user.id,
          username: user.username,
          email: user.email,
          firstName: user.firstName,
          lastName: user.lastName,
          roleCode: userTenant.role.code,
          roleName: userTenant.role.name,
        },
        tenant: {
          id: userTenant.tenant.id,
          name: userTenant.tenant.name,
          code: userTenant.tenant.code,
          plan: userTenant.tenant.plan,
          enabledModules: userTenant.tenant.modules.map(m => m.module),
        },
        permissions: [...new Set(permStrings)],
      };
    sessionCache.set(cacheKey, { ts: Date.now(), body });

    return NextResponse.json(
      body,
      {
        headers: {
          // Browser caches session for 60 s and serves stale for 120 s while revalidating.
          // Private so CDNs don't share user-specific permission sets across accounts.
          'Cache-Control': 'private, max-age=60, stale-while-revalidate=120',
        },
      }
    );
  } catch (e) {
    console.error('[GET /api/admin/session] error:', e);
    const msg = e instanceof Error ? e.message : String(e);
    return NextResponse.json({ error: 'Failed', detail: msg }, { status: 500 });
  }
}
