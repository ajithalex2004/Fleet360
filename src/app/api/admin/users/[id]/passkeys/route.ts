export const dynamic = 'force-dynamic';

import { NextRequest, NextResponse } from 'next/server';
import { requireAuthorizedTenant } from '@/lib/tenant-context';
import { removeAllPasskeys } from '@/lib/auth/passkeys';
import { logAudit } from '@/lib/audit';

export const runtime = 'nodejs';

/**
 * DELETE /api/admin/users/:id/passkeys
 *
 * Platform administrators only, after their own passkey step-up (both
 * enforced in middleware). Removes every passkey of a user who lost their
 * device; the user then adds a new one with their password.
 */
export async function DELETE(req: NextRequest, props: { params: Promise<{ id: string }> }) {
  const { id: userId } = await props.params;
  const authz = requireAuthorizedTenant({ headers: req.headers });
  if (!authz.ok) return NextResponse.json({ error: authz.error }, { status: authz.status });
  const removed = await removeAllPasskeys(userId);
  await logAudit({
    tenantId: authz.tenantId, entityType: 'Passkey', entityId: userId, action: 'DELETE',
    details: `All ${removed} passkey(s) of user ${userId} removed by a platform administrator`, userId: authz.userId ?? undefined,
  });
  return NextResponse.json({ ok: true, removed });
}
