import { NextRequest, NextResponse } from 'next/server';
import { isDbConnectionError, prisma } from '@/lib/prisma';
import { withPlatformAdmin } from '@/lib/rls';
import { verifySession } from '@/lib/tenant-session';

let lastDbUnavailableWarnAt = 0;
const DB_UNAVAILABLE_WARN_INTERVAL_MS = 30_000;

function sessionResponse(body: Record<string, string>, status: number) {
  return NextResponse.json(body, {
    status,
    headers: { 'Cache-Control': 'private, no-store' },
  });
}

function isSessionDbUnavailable(err: unknown): boolean {
  if (isDbConnectionError(err)) return true;
  if (!err || typeof err !== 'object') return false;
  const error = err as { name?: unknown; message?: unknown; code?: unknown; cause?: unknown };
  const name = String(error.name ?? '');
  const code = String(error.code ?? '');
  const message = String(error.message ?? '');
  return (
    name.includes('DbConnectionError') ||
    ['P1000', 'P1001', 'P1002', 'P1017'].includes(code) ||
    message.includes('Database connection unavailable') ||
    message.includes("Can't reach database server") ||
    message.includes('Server has closed the connection') ||
    message.includes('Connection terminated') ||
    message.includes('connection timed out') ||
    isSessionDbUnavailable(error.cause)
  );
}

export async function GET(req: NextRequest) {
  try {
    const { searchParams } = new URL(req.url);
    const requestedUserId = searchParams.get('userId');
    const requestedTenantId = searchParams.get('tenantId');
    const token = req.cookies.get('xl-session')?.value;
    const cookieSession = token ? await verifySession(token) : null;

    const userId = requestedUserId ?? req.headers.get('x-user-id') ?? cookieSession?.userId;
    const tenantId = requestedTenantId ?? req.headers.get('x-tenant-id') ?? cookieSession?.tenantId;

    if (!userId || !tenantId) {
      return sessionResponse({ error: 'Valid session required' }, 401);
    }

    if (!cookieSession && (!req.headers.get('x-user-id') || !req.headers.get('x-tenant-id'))) {
      return sessionResponse({ error: 'Valid session required' }, 401);
    }

    if (
      cookieSession &&
      ((requestedUserId && requestedUserId !== cookieSession.userId) ||
        (requestedTenantId && requestedTenantId !== cookieSession.tenantId))
    ) {
      return sessionResponse({ error: 'Session does not match requested tenant' }, 403);
    }

    // Session lookup crosses User (global, no RLS) and UserTenant (tenant-scoped
    // RLS). We use withPlatformAdmin so the UserTenant lookup is allowed even
    // if the request's tenant context is not yet established (this route is
    // the bootstrap for the session, after all).
    return await withPlatformAdmin(prisma, async (tx) => {
      // Get user
      const user = await tx.user.findUnique({ where: { id: userId } });
      if (!user) return sessionResponse({ error: 'User not found' }, 404);

      // Get user-tenant assignment with role
      const userTenant = await tx.userTenant.findUnique({
        where: { userId_tenantId: { userId, tenantId } },
        include: {
          role: { include: { permissions: { include: { permission: true } } } },
          tenant: { include: { modules: { where: { isEnabled: true } } } },
        },
      });
      if (!userTenant || !userTenant.isActive) {
        return sessionResponse({ error: 'User has no active access to this tenant' }, 403);
      }

      // Build permission strings
      const permStrings: string[] = userTenant.role.permissions.map(rp =>
        `${rp.permission.module}:${rp.permission.action}:${rp.permission.resource ?? '*'}`
      );

      // SUPER_ADMIN gets wildcard — but only when the role is system-wide.
      // A per-tenant role with code=SUPER_ADMIN is a tenant-level admin and gets
      // only the role's explicit permissions, scoped to that tenant by RLS.
      if (userTenant.role.code === 'SUPER_ADMIN' && userTenant.role.tenantId === null) {
        permStrings.push('*:*:*');
      }

      return NextResponse.json(
        {
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
        },
        {
          headers: {
            // Auth state must not be shared or replayed after sign-out. The client
            // keeps its own short-lived snapshot for fast paints between reloads.
            'Cache-Control': 'private, no-store',
          },
        }
      );
    });
    } catch (e) {
    if (isSessionDbUnavailable(e)) {
      warnDbUnavailable(e);
      return sessionResponse({ error: 'Database connection unavailable' }, 503);
    }
    console.error(e);
    return sessionResponse({ error: 'Failed' }, 500);
  }
}

function warnDbUnavailable(err: unknown) {
  const now = Date.now();
  if (now - lastDbUnavailableWarnAt < DB_UNAVAILABLE_WARN_INTERVAL_MS) return;
  lastDbUnavailableWarnAt = now;
  console.warn(`[api/admin/session] Database connection unavailable while loading session: ${summarizeDbError(err)}`);
}

function summarizeDbError(err: unknown): string {
  const seen = new Set<unknown>();
  let current = err;

  while (current && typeof current === 'object' && !seen.has(current)) {
    seen.add(current);
    const error = current as { code?: unknown; message?: unknown; cause?: unknown };
    const code = error.code ? `${String(error.code)} ` : '';
    const message = String(error.message ?? '').split('\n')[0]?.trim();
    if (message) return `${code}${message}`.trim();
    current = error.cause;
  }

  return err instanceof Error ? err.message : String(err);
}
