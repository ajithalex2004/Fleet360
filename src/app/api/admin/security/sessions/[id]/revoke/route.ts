import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { requireAdminPermission, requireDangerApproval, resolveTenantBoundary } from '@/lib/admin-policy';
import { ensureSessionRegistryTable, revokeSession } from '@/lib/session-registry';
import { recordAdminChange } from '@/lib/admin-change-history';

export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const auth = await requireAdminPermission(req, 'edit', 'security');
  if (auth instanceof NextResponse) return auth;

  const { id } = await params;
  await ensureSessionRegistryTable();
  const rows = await prisma.$queryRawUnsafe<Array<{ id: string; tenant_id: string; user_id: string; revoked_at: string | null }>>(
    `SELECT id, tenant_id, user_id, revoked_at::text FROM auth_sessions WHERE id = $1 LIMIT 1`,
    id,
  );
  const session = rows[0];
  if (!session) return NextResponse.json({ error: 'Session not found' }, { status: 404 });
  const scoped = resolveTenantBoundary(auth.ctx, session.tenant_id);
  if (scoped instanceof NextResponse) return scoped;
  if (session.user_id === auth.ctx.userId && req.headers.get('x-session-id') === id) {
    return NextResponse.json({ error: 'Use logout to revoke your current session' }, { status: 400 });
  }

  const approval = await requireDangerApproval(req, auth.ctx, 'session.revoke', {
    tenantId: session.tenant_id,
    targetType: 'AuthSession',
    targetId: id,
    summary: `Revoke session ${id}.`,
  });
  if (approval) return approval;

  await revokeSession(id, auth.ctx.userId, 'admin-revoked');
  await recordAdminChange({
    req,
    ctx: auth.ctx,
    tenantId: session.tenant_id,
    entityType: 'AuthSession',
    entityId: id,
    action: 'REVOKE',
    before: session,
    after: { revoked: true },
    summary: `Revoked session ${id}.`,
  });
  return NextResponse.json({ ok: true });
}
