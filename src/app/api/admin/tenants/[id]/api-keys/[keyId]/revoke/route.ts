/**
 * POST /api/admin/tenants/[id]/api-keys/[keyId]/revoke
 * Revokes an API key. Idempotent.
 */

import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { ensureApiKeyTable } from '@/lib/api-keys';
import { logAudit } from '@/lib/audit';
import { captureException } from '@/lib/sentry';

export const runtime = 'nodejs';

interface RouteParams { params: Promise<{ id: string; keyId: string }>; }

export async function POST(req: NextRequest, { params }: RouteParams) {
  const { id: tenantId, keyId } = await params;

  const role     = req.headers.get('x-user-role') ?? '';
  const userId   = req.headers.get('x-user-id')   ?? '';
  const ctxTenant = req.headers.get('x-tenant-id') ?? '';
  if (!userId) return NextResponse.json({ ok: false, error: 'Not authenticated' }, { status: 401 });
  if (role !== 'SUPER_ADMIN' && ctxTenant !== tenantId) {
    return NextResponse.json({ ok: false, error: 'Forbidden' }, { status: 403 });
  }

  try {
    await ensureApiKeyTable();
    const result = await prisma.$executeRawUnsafe(
      `UPDATE tenant_api_keys
         SET revoked = TRUE, revoked_at = NOW()
       WHERE id = $1::uuid AND tenant_id = $2 AND revoked = FALSE`,
      keyId, tenantId,
    );

    void logAudit({
      tenantId,
      userId,
      userRole: 'TENANT_ADMIN',
      entityType: 'ApiKey',
      entityId: keyId,
      action: 'DELETE',
      details: 'API key revoked.',
    });

    return NextResponse.json({ ok: true, changed: result });
  } catch (err) {
    captureException(err, { context: 'admin.api-keys.revoke' });
    return NextResponse.json({ ok: false, error: 'Revoke failed' }, { status: 500 });
  }
}
