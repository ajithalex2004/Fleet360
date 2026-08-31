export const dynamic = 'force-dynamic';

/**
 * User hard-delete — permanently destroy a user and all of their data.
 *
 * POST /api/admin/users/[id]/hard-delete?dryRun=true|false
 *
 * Default is dryRun=true. Caller must explicitly opt in with
 * ?dryRun=false. Both paths return the same shape so the UI can
 * show a preview, then execute with a typed-email confirmation.
 *
 * What gets deleted (in order, in a single transaction):
 *   1. All UserTenant rows for this user (memberships across all tenants)
 *   2. The User row itself
 *
 * Does NOT touch: tenants, audit logs authored by the user (those stay
 * with a userId pointer that may become orphaned — the user_audit_log
 * table is append-only and keeps the userId even if the User row is gone).
 *
 * Hard delete is irreversible. Every run is recorded in
 * platform_audit_log.
 *
 * SUPER_ADMIN only. PROTECTED_EMAILS whitelist enforced.
 */

import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { withPlatformAdmin, withTenantRls } from '@/lib/rls';
import { logAudit } from '@/lib/platform-audit-log';

import { requireAuthorizedTenant, stripTenantOwnershipFields } from '@/lib/tenant-context';
interface RouteParams { params: Promise<{ id: string }>; }

// Hardcoded whitelist — server-side enforcement, never trust the UI.
// These accounts are real operators. If they have no active membership
// right now, they should be re-invited, not deleted.
const PROTECTED_EMAILS: readonly string[] = [
  'admin@xl-mobility.com',  // Platform Admin
];

function requireSuperAdmin(req: NextRequest): { ok: true; userId: string; email: string } | { ok: false; res: NextResponse } {
  const role   = req.headers.get('x-user-role')  ?? '';
  const userId = req.headers.get('x-user-id')    ?? '';
  const email  = req.headers.get('x-user-email') ?? '';
  if (role !== 'SUPER_ADMIN') {
    return {
      ok: false,
      res: NextResponse.json(
        { error: 'Forbidden', message: 'Platform admin only. Requires a system-wide SUPER_ADMIN role.' },
        { status: 403 },
      ),
    };
  }
  if (!userId) {
    return { ok: false, res: NextResponse.json({ error: 'No session' }, { status: 401 }) };
  }
  return { ok: true, userId, email };
}

export async function POST(req: NextRequest, { params }: RouteParams) {
  const authz = requireAuthorizedTenant({ headers: req.headers, nextUrl: req.nextUrl });
  if (!authz.ok) {
    return NextResponse.json({ error: authz.error }, { status: authz.status });
  }
  const { tenantId } = authz;

  const auth = requireSuperAdmin(req);
  if (!auth.ok) return auth.res;

  const { id: userId } = await params;
  if (!userId) {
    return NextResponse.json({ error: 'user id is required' }, { status: 400 });
  }

  const dryRun = (req.nextUrl.searchParams.get('dryRun') ?? 'true') !== 'false';

  // 1. Confirm user exists + gather data for audit
  const user = await withPlatformAdmin(prisma, async (tx) => {
    return tx.user.findUnique({
      where: { id: userId },
      select: { id: true, email: true, username: true, firstName: true, lastName: true, isActive: true },
    });
  });
  if (!user) {
    return NextResponse.json({ error: 'User not found' }, { status: 404 });
  }

  // 2. Refuse protected emails
  if (PROTECTED_EMAILS.includes(user.email)) {
    return NextResponse.json(
      {
        error: 'Refused',
        message: `${user.email} is a protected operator account. Hard-delete is not allowed.`,
      },
      { status: 400 },
    );
  }

  // 3. Count what would be deleted (or what was deleted)
  const counts = await withPlatformAdmin(prisma, async (tx) => {
    const memberships = await tx.userTenant.count({ where: { userId } });
    return { memberships };
  });

  if (dryRun) {
    await logAudit({
      action: 'user.hard_delete',
      targetType: 'user',
      targetId: userId,
      targetName: user.email,
      performedBy: { userId: auth.userId, email: auth.email },
      dryRun: true,
      metadata: { user, counts },
    });
    return NextResponse.json({
      dryRun: true,
      user: { id: userId, email: user.email, username: user.username, firstName: user.firstName, lastName: user.lastName },
      counts,
    });
  }

  // 4. Actual destructive run — single transaction
  const result = await withPlatformAdmin(prisma, async (tx) => {
    const ut = await tx.userTenant.deleteMany({ where: { userId } });
    const u  = await tx.user.delete({ where: { id: userId } });
    return { membershipsDeleted: ut.count, userDeleted: 1, deletedEmail: u.email };
  });

  await logAudit({
    action: 'user.hard_delete',
    targetType: 'user',
    targetId: userId,
    targetName: user.email,
    performedBy: { userId: auth.userId, email: auth.email },
    dryRun: false,
    metadata: { ...result, countsBefore: counts },
  });

  // Bust the cached user list so the platform dashboard and user list
  // page see the deletion on the next render.
  const { revalidateCache } = await import('@/lib/server-cache');
  revalidateCache(['users:list']);

  return NextResponse.json({
    dryRun: false,
    user: { id: userId, email: user.email, username: user.username },
    counts: {
      membershipsDeleted: result.membershipsDeleted,
      userDeleted:        result.userDeleted,
    },
  });
}
