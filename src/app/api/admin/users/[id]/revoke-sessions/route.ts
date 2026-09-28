export const dynamic = 'force-dynamic';

import { NextRequest, NextResponse } from 'next/server';
import { requireAuthorizedTenant } from '@/lib/tenant-context';
import { isSuperAdmin } from '@/lib/admin-access';
import { prisma } from '@/lib/prisma';
import { withPlatformAdmin } from '@/lib/rls';
import { revokeSessions } from '@/lib/auth/session-revocation';

export const runtime = 'nodejs';

/**
 * POST /api/admin/users/:id/revoke-sessions
 *
 * Ends a user's sessions within 60 s (and their Go-backend tokens). A
 * platform administrator revokes them everywhere; a tenant administrator
 * only in their own tenant, and only for a member of it.
 */
export async function POST(req: NextRequest, props: { params: Promise<{ id: string }> }) {
  const { id: userId } = await props.params;
  const authz = requireAuthorizedTenant({ headers: req.headers });
  if (!authz.ok) return NextResponse.json({ error: authz.error }, { status: authz.status });

  if (isSuperAdmin(req.headers)) {
    await revokeSessions({ userId, reason: 'revoked-by-platform-admin', revokedBy: authz.userId });
    return NextResponse.json({ ok: true, scope: 'all-tenants' });
  }

  const member = await withPlatformAdmin(prisma, (tx) =>
    tx.userTenant.findUnique({ where: { userId_tenantId: { userId, tenantId: authz.tenantId } }, select: { id: true } }),
  );
  if (!member) return NextResponse.json({ error: 'User not found in your company' }, { status: 404 });
  await revokeSessions({ userId, tenantId: authz.tenantId, reason: 'revoked-by-tenant-admin', revokedBy: authz.userId });
  return NextResponse.json({ ok: true, scope: 'tenant' });
}
