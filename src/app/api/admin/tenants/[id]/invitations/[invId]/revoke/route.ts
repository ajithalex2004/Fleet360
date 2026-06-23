/**
 * POST /api/admin/tenants/[id]/invitations/[invId]/revoke
 * Revokes a pending invitation. Idempotent.
 */

import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { ensureInvitationTable } from '@/lib/invitations';
import { captureException } from '@/lib/sentry';
import { requireAdminPermission, resolveTenantBoundary } from '@/lib/admin-policy';
import { recordAdminChange } from '@/lib/admin-change-history';

export const runtime = 'nodejs';

interface RouteParams { params: Promise<{ id: string; invId: string }>; }

export async function POST(req: NextRequest, { params }: RouteParams) {
  const { id, invId } = await params;
  const auth = await requireAdminPermission(req, 'delete', 'users');
  if (auth instanceof NextResponse) return auth;
  const tenantId = resolveTenantBoundary(auth.ctx, id);
  if (tenantId instanceof NextResponse) return tenantId;

  try {
    await ensureInvitationTable();
    const beforeRows = await prisma.$queryRawUnsafe<Array<{
      id: string; tenant_id: string; email: string; role_id: string; revoked: boolean; used_at: string | null; expires_at: string;
    }>>(
      `SELECT id::text, tenant_id, email, role_id, revoked, used_at::text, expires_at::text
         FROM tenant_invitations
        WHERE id = $1::uuid AND tenant_id = $2
        LIMIT 1`,
      invId, tenantId,
    ).catch(() => []);
    const before = beforeRows[0] ?? null;
    const result = await prisma.$executeRawUnsafe(
      `UPDATE tenant_invitations
         SET revoked = TRUE
       WHERE id = $1::uuid AND tenant_id = $2 AND used_at IS NULL AND revoked = FALSE`,
      invId, tenantId,
    );

    const afterRows = await prisma.$queryRawUnsafe<Array<{
      id: string; tenant_id: string; email: string; role_id: string; revoked: boolean; used_at: string | null; expires_at: string;
    }>>(
      `SELECT id::text, tenant_id, email, role_id, revoked, used_at::text, expires_at::text
         FROM tenant_invitations
        WHERE id = $1::uuid AND tenant_id = $2
        LIMIT 1`,
      invId, tenantId,
    ).catch(() => []);

    await recordAdminChange({
      req,
      ctx: auth.ctx,
      tenantId,
      entityType: 'Invitation',
      entityId: invId,
      entityName: before?.email,
      action: 'DELETE',
      before,
      after: afterRows[0] ?? null,
      summary: `Invitation revoked.`,
    });

    return NextResponse.json({ ok: true, changed: result });
  } catch (err) {
    captureException(err, { context: 'admin.invitations.revoke' });
    return NextResponse.json({ ok: false, error: 'Revoke failed' }, { status: 500 });
  }
}
