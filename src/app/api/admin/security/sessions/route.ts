import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { requireAdminPermission, resolveTenantBoundary } from '@/lib/admin-policy';
import { ensureSessionRegistryTable } from '@/lib/session-registry';

export async function GET(req: NextRequest) {
  const auth = await requireAdminPermission(req, 'view', 'security');
  if (auth instanceof NextResponse) return auth;

  const { searchParams } = new URL(req.url);
  const requestedTenantId = searchParams.get('tenantId');
  const limit = Math.min(Math.max(Number(searchParams.get('limit') ?? 50), 1), 100);
  const tenantId = auth.ctx.isSuperAdmin && !requestedTenantId
    ? ''
    : resolveTenantBoundary(auth.ctx, requestedTenantId);
  if (tenantId instanceof NextResponse) return tenantId;

  await ensureSessionRegistryTable();
  const rows = await prisma.$queryRawUnsafe<Array<{
    id: string;
    user_id: string;
    user_email: string | null;
    tenant_id: string;
    tenant_name: string | null;
    role_code: string | null;
    plan_code: string | null;
    impersonated_by: string | null;
    ip_address: string | null;
    user_agent: string | null;
    created_at: string;
    last_seen_at: string;
    expires_at: string;
    revoked_at: string | null;
    revoked_by: string | null;
    revoke_reason: string | null;
    status: 'ACTIVE' | 'EXPIRED' | 'REVOKED';
  }>>(
    `SELECT s.id, s.user_id, u.email AS user_email, s.tenant_id, t.name AS tenant_name,
            s.role_code, s.plan_code, s.impersonated_by, s.ip_address, s.user_agent,
            s.created_at::text, s.last_seen_at::text, s.expires_at::text,
            s.revoked_at::text, s.revoked_by, s.revoke_reason,
            CASE
              WHEN s.revoked_at IS NOT NULL THEN 'REVOKED'
              WHEN s.expires_at < NOW() THEN 'EXPIRED'
              ELSE 'ACTIVE'
            END AS status
       FROM auth_sessions s
       LEFT JOIN "User" u ON u.id = s.user_id
       LEFT JOIN tenants t ON t.id = s.tenant_id
      WHERE ($1 = '' OR s.tenant_id = $1)
      ORDER BY
        CASE WHEN s.revoked_at IS NULL AND s.expires_at >= NOW() THEN 0 ELSE 1 END,
        s.last_seen_at DESC
      LIMIT $2`,
    tenantId,
    limit,
  );

  const sessions = rows.map(s => ({
    id: s.id,
    userId: s.user_id,
    userEmail: s.user_email,
    tenantId: s.tenant_id,
    tenantName: s.tenant_name,
    role: s.role_code,
    plan: s.plan_code,
    impersonatedBy: s.impersonated_by,
    ipAddress: s.ip_address,
    userAgent: s.user_agent,
    createdAt: s.created_at,
    lastSeenAt: s.last_seen_at,
    expiresAt: s.expires_at,
    revokedAt: s.revoked_at,
    revokedBy: s.revoked_by,
    revokeReason: s.revoke_reason,
    status: s.status,
  }));

  return NextResponse.json(
    {
      sessions,
      activeCount: sessions.filter(s => s.status === 'ACTIVE').length,
      totalReturned: sessions.length,
    },
    { headers: { 'Cache-Control': 'private, max-age=10, stale-while-revalidate=30' } },
  );
}
