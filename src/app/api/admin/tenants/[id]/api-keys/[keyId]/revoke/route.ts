/**
 * POST /api/admin/tenants/[id]/api-keys/[keyId]/revoke
 * Revokes an API key. Idempotent.
 */

import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { ensureApiKeyTable } from '@/lib/api-keys';
import { captureException } from '@/lib/sentry';
import { requireAdminPermission, requireDangerApproval, resolveTenantBoundary } from '@/lib/admin-policy';
import { recordAdminChange } from '@/lib/admin-change-history';

export const runtime = 'nodejs';

interface RouteParams { params: Promise<{ id: string; keyId: string }>; }

export async function POST(req: NextRequest, { params }: RouteParams) {
  const { id: tenantId, keyId } = await params;

  const auth = await requireAdminPermission(req, 'delete', 'integrations');
  if (auth instanceof NextResponse) return auth;
  const scopedTenantId = resolveTenantBoundary(auth.ctx, tenantId);
  if (scopedTenantId instanceof NextResponse) return scopedTenantId;
  const approval = await requireDangerApproval(req, auth.ctx, 'api-key.revoke', {
    tenantId,
    targetType: 'ApiKey',
    targetId: keyId,
    summary: `Revoke API key ${keyId}.`,
  });
  if (approval) return approval;

  try {
    await ensureApiKeyTable();
    const before = await prisma.$queryRawUnsafe<Array<{ id: string; name: string; prefix: string; revoked: boolean }>>(
      `SELECT id::text, name, prefix, revoked FROM tenant_api_keys WHERE id = $1::uuid AND tenant_id = $2 LIMIT 1`,
      keyId, tenantId,
    ).catch(() => []);
    const result = await prisma.$executeRawUnsafe(
      `UPDATE tenant_api_keys
         SET revoked = TRUE, revoked_at = NOW()
       WHERE id = $1::uuid AND tenant_id = $2 AND revoked = FALSE`,
      keyId, tenantId,
    );

    await recordAdminChange({
      req,
      ctx: auth.ctx,
      tenantId,
      entityType: 'ApiKey',
      entityId: keyId,
      action: 'DELETE',
      before: before[0] ?? null,
      after: { revoked: true },
      summary: 'API key revoked.',
    });

    return NextResponse.json({ ok: true, changed: result });
  } catch (err) {
    captureException(err, { context: 'admin.api-keys.revoke' });
    return NextResponse.json({ ok: false, error: 'Revoke failed' }, { status: 500 });
  }
}
