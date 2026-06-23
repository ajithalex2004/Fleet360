import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { ensureInvitationTable } from '@/lib/invitations';
import { requireAdminPermission, resolveTenantBoundary } from '@/lib/admin-policy';

export async function GET(req: NextRequest) {
  try {
    const auth = await requireAdminPermission(req, 'view', 'users');
    if (auth instanceof NextResponse) return auth;

    await ensureInvitationTable();
    const sp = req.nextUrl.searchParams;
    const tenantBoundary = resolveTenantBoundary(auth.ctx, sp.get('tenantId'));
    if (tenantBoundary instanceof NextResponse) return tenantBoundary;
    const status = sp.get('status') ?? '';

    const conditions = ['i.tenant_id = $1'];
    const args: unknown[] = [tenantBoundary];
    if (status === 'pending') conditions.push('i.used_at IS NULL AND i.revoked = FALSE AND i.expires_at > NOW()');
    if (status === 'accepted') conditions.push('i.used_at IS NOT NULL');
    if (status === 'revoked') conditions.push('i.revoked = TRUE');
    if (status === 'expired') conditions.push('i.used_at IS NULL AND i.revoked = FALSE AND i.expires_at <= NOW()');

    const rows = await prisma.$queryRawUnsafe<Array<{
      id: string; tenant_id: string; tenant_name: string | null;
      email: string; role_id: string; role_name: string | null;
      invited_by_user_id: string | null; invited_by_email: string | null;
      expires_at: string; used_at: string | null; revoked: boolean; created_at: string;
    }>>(
      `SELECT i.id::text, i.tenant_id, t.name AS tenant_name,
              i.email, i.role_id, r.name AS role_name,
              i.invited_by_user_id, u.email AS invited_by_email,
              i.expires_at::text, i.used_at::text, i.revoked, i.created_at::text
         FROM tenant_invitations i
         LEFT JOIN tenants t ON t.id = i.tenant_id
         LEFT JOIN roles r ON r.id = i.role_id
         LEFT JOIN "User" u ON u.id = i.invited_by_user_id
        WHERE ${conditions.join(' AND ')}
        ORDER BY i.created_at DESC
        LIMIT 500`,
      ...args,
    );

    const now = new Date();
    return NextResponse.json({
      ok: true,
      invitations: rows.map(r => ({
        id: r.id,
        tenantId: r.tenant_id,
        tenantName: r.tenant_name,
        email: r.email,
        roleId: r.role_id,
        roleName: r.role_name,
        invitedBy: r.invited_by_email ?? r.invited_by_user_id,
        expiresAt: r.expires_at,
        usedAt: r.used_at,
        revoked: r.revoked,
        createdAt: r.created_at,
        status:
          r.used_at ? 'accepted'
          : r.revoked ? 'revoked'
          : new Date(r.expires_at) < now ? 'expired'
          : 'pending',
      })),
    });
  } catch (e) {
    console.error('[admin/invitations] GET error:', e);
    return NextResponse.json({ error: 'Failed to load invitations' }, { status: 500 });
  }
}

