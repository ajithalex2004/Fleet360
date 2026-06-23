import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { requireAdminRole } from '@/lib/admin-auth';
import { isSessionRevoked } from '@/lib/session-registry';

const OVERVIEW_TTL_MS = 30_000;
const overviewCache = new Map<string, { ts: number; body: OverviewResponse }>();

interface OverviewResponse {
  stats: {
    tenants: number;
    users: number;
    roles: number;
    permissions: number;
    pendingApprovals: number;
    failedLogins24h: number;
  };
  scope: {
    tenantId: string;
    roleCode: string;
    isSuperAdmin: boolean;
  };
  operational: {
    generatedAt: string;
    queryMs: number;
    cache: 'hit' | 'miss';
  };
}

function cacheHeaders(cache: 'hit' | 'miss', queryMs: number) {
  return {
    'Cache-Control': 'private, max-age=30, stale-while-revalidate=60',
    'X-Fleet360-Cache': cache,
    'X-Fleet360-Query-Ms': String(queryMs),
  };
}

export async function GET(req: NextRequest) {
  const started = Date.now();
  const ctx = requireAdminRole(req, ['SUPER_ADMIN', 'TENANT_ADMIN']);
  if (ctx instanceof NextResponse) return ctx;

  const sessionId = req.headers.get('x-session-id');
  if (sessionId && await isSessionRevoked(sessionId)) {
    return NextResponse.json({ error: 'Unauthorized', message: 'Session has been revoked' }, { status: 401 });
  }

  const cacheKey = `${ctx.userId}:${ctx.tenantId}:${ctx.role}`;
  const cached = overviewCache.get(cacheKey);
  if (cached && Date.now() - cached.ts < OVERVIEW_TTL_MS) {
    const queryMs = Date.now() - started;
    return NextResponse.json(
      { ...cached.body, operational: { ...cached.body.operational, cache: 'hit', queryMs } },
      { headers: cacheHeaders('hit', queryMs) },
    );
  }

  const tenantWhere = ctx.isSuperAdmin ? {} : { id: ctx.tenantId };
  const userTenantWhere = ctx.isSuperAdmin ? { isActive: true } : { tenantId: ctx.tenantId, isActive: true };
  const roleWhere = ctx.isSuperAdmin
    ? {}
    : { OR: [{ tenantId: ctx.tenantId }, { tenantId: null, isSystem: true }] };

  const [
    tenants,
    users,
    roles,
    permissions,
    pendingApprovalsRows,
    failedLoginRows,
  ] = await Promise.all([
    prisma.tenant.count({ where: tenantWhere }),
    prisma.userTenant.count({ where: userTenantWhere }),
    prisma.role.count({ where: roleWhere }),
    prisma.permission.count(),
    prisma.$queryRawUnsafe<Array<{ count: bigint }>>(
      `SELECT COUNT(*)::bigint AS count
         FROM admin_approval_requests
        WHERE status = 'PENDING'
          AND ($1::boolean = true OR tenant_id = $2)`,
      ctx.isSuperAdmin,
      ctx.tenantId,
    ).catch(() => [{ count: BigInt(0) }]),
    prisma.$queryRawUnsafe<Array<{ count: bigint }>>(
      `SELECT COUNT(*)::bigint AS count
         FROM auth_login_attempts
        WHERE success = false
          AND occurred_at >= NOW() - INTERVAL '24 hours'
          AND ($1::boolean = true OR tenant_id = $2)`,
      ctx.isSuperAdmin,
      ctx.tenantId,
    ).catch(() => [{ count: BigInt(0) }]),
  ]);

  const queryMs = Date.now() - started;
  const body: OverviewResponse = {
    stats: {
      tenants,
      users,
      roles,
      permissions,
      pendingApprovals: Number(pendingApprovalsRows[0]?.count ?? 0),
      failedLogins24h: Number(failedLoginRows[0]?.count ?? 0),
    },
    scope: {
      tenantId: ctx.tenantId,
      roleCode: ctx.role,
      isSuperAdmin: ctx.isSuperAdmin,
    },
    operational: {
      generatedAt: new Date().toISOString(),
      queryMs,
      cache: 'miss',
    },
  };
  overviewCache.set(cacheKey, { ts: Date.now(), body });

  return NextResponse.json(body, { headers: cacheHeaders('miss', queryMs) });
}
