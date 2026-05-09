/**
 * POST /api/admin/tenants/[id]/invitations/[invId]/revoke
 * Revokes a pending invitation. Idempotent.
 */

import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { ensureInvitationTable } from '@/lib/invitations';
import { logAudit } from '@/lib/audit';
import { captureException } from '@/lib/sentry';

export const runtime = 'nodejs';

interface RouteParams { params: Promise<{ id: string; invId: string }>; }

export async function POST(req: NextRequest, { params }: RouteParams) {
  const { id: tenantId, invId } = await params;

  const role     = req.headers.get('x-user-role')   ?? '';
  const userId   = req.headers.get('x-user-id')     ?? '';
  const ctxTenant = req.headers.get('x-tenant-id')  ?? '';
  if (!userId) return NextResponse.json({ ok: false, error: 'Not authenticated' }, { status: 401 });
  if (role !== 'SUPER_ADMIN' && ctxTenant !== tenantId) {
    return NextResponse.json({ ok: false, error: 'Forbidden' }, { status: 403 });
  }

  try {
    await ensureInvitationTable();
    const result = await prisma.$executeRawUnsafe(
      `UPDATE tenant_invitations
         SET revoked = TRUE
       WHERE id = $1::uuid AND tenant_id = $2 AND used_at IS NULL AND revoked = FALSE`,
      invId, tenantId,
    );

    void logAudit({
      tenantId,
      userId,
      userRole: 'TENANT_ADMIN',
      entityType: 'Invitation',
      entityId: invId,
      action: 'DELETE',
      details: `Invitation revoked.`,
    });

    return NextResponse.json({ ok: true, changed: result });
  } catch (err) {
    captureException(err, { context: 'admin.invitations.revoke' });
    return NextResponse.json({ ok: false, error: 'Revoke failed' }, { status: 500 });
  }
}
