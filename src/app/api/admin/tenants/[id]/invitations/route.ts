export const dynamic = 'force-dynamic';

/**
 * /api/admin/tenants/[id]/invitations
 *
 * GET   — list invitations for a tenant (active + used + revoked), plus the
 *         roles an invitation can grant: the tenant's own roles and the
 *         platform roles (Tenant Administrator, Fleet Manager, …).
 * POST  — invite a user. Body: { email, roleId } and optionally firstName,
 *         lastName, mobileNumber, position, departmentId, moduleAccess
 *         (src/lib/admin/member-onboarding.ts)
 *
 * Authorization:
 *  - SUPER_ADMIN: may invite into any tenant
 *  - TENANT_ADMIN: may only invite into their own tenant
 */

import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { withPlatformAdmin, withTenantRls } from '@/lib/rls';
import { sessionUser } from '@/lib/session-user';
import { captureException } from '@/lib/sentry';
import { inviteMember, parseNewMember } from '@/lib/admin/member-onboarding';

import { requireAuthorizedTenant, stripTenantOwnershipFields } from '@/lib/tenant-context';
import { withAuditedAction } from '@/lib/audited-action';
export const runtime = 'nodejs';

interface RouteParams { params: Promise<{ id: string }>; }

function authorize(req: NextRequest, tenantId: string): { ok: true; userId: string } | { ok: false; res: NextResponse } {
  const role     = req.headers.get('x-user-role')   ?? '';
  const userId   = req.headers.get('x-user-id')     ?? '';
  const ctxTenant = req.headers.get('x-tenant-id')  ?? '';
  if (!userId) {
    return { ok: false, res: NextResponse.json({ ok: false, error: 'Not authenticated' }, { status: 401 }) };
  }
  if (role !== 'SUPER_ADMIN' && ctxTenant !== tenantId) {
    return { ok: false, res: NextResponse.json({ ok: false, error: 'Forbidden' }, { status: 403 }) };
  }
  return { ok: true, userId };
}

export async function GET(req: NextRequest, { params }: RouteParams) {
  const authz = requireAuthorizedTenant({ headers: req.headers, nextUrl: req.nextUrl });
  if (!authz.ok) {
    return NextResponse.json({ error: authz.error }, { status: authz.status });
  }
  const { id: tenantId } = await params;
  const auth = authorize(req, tenantId);
  if (!auth.ok) return auth.res;


  // tenant_invitations has tenant_id with RLS. Join to roles (also RLS)
  // and User (global) — wrap with withTenantRls so the join sees the
  // right rows and any future RLS on tenants / roles / users is honored.
  const rows = await withTenantRls(prisma, tenantId, (tx) =>
    tx.$queryRawUnsafe<Array<{
      id: string; email: string; role_id: string; role_name: string;
      invited_by_user_id: string | null; invited_by_email: string | null;
      expires_at: string; used_at: string | null; revoked: boolean; created_at: string;
    }>>(
      `SELECT i.id::text, i.email, i.role_id, r.name AS role_name,
              i.invited_by_user_id, u.email AS invited_by_email,
              i.expires_at::text, i.used_at::text, i.revoked, i.created_at::text
       FROM tenant_invitations i
       LEFT JOIN roles  r ON r.id = i.role_id
       LEFT JOIN "User" u ON u.id = i.invited_by_user_id
       WHERE i.tenant_id = $1
       ORDER BY i.created_at DESC
       LIMIT 200`,
      tenantId,
    )
  );

  // Platform roles have no tenant_id, so a new tenant owns no roles of its
  // own; list both. SUPER_ADMIN is never granted through a tenant invite.
  const roleRows = await withPlatformAdmin(prisma, (tx) => tx.role.findMany({
    where: { OR: [{ tenantId }, { tenantId: null }], NOT: { code: 'SUPER_ADMIN' } },
    select: { id: true, name: true, code: true, tenantId: true, _count: { select: { permissions: true } } },
    orderBy: { name: 'asc' },
  }));

  const now = new Date();
  return NextResponse.json({
    ok: true,
    roles: roleRows.map(r => ({
      id: r.id, name: r.name, code: r.code,
      scope: r.tenantId ? 'tenant' : 'platform',
      permissionCount: r._count.permissions,
    })),
    invitations: rows.map(r => ({
      id: r.id,
      email: r.email,
      roleId: r.role_id,
      roleName: r.role_name,
      invitedBy: r.invited_by_email ?? r.invited_by_user_id,
      expiresAt: r.expires_at,
      usedAt: r.used_at,
      revoked: r.revoked,
      createdAt: r.created_at,
      status:
        r.used_at  ? 'accepted'
        : r.revoked ? 'revoked'
        : new Date(r.expires_at) < now ? 'expired'
        : 'pending',
    })),
  });
}

async function handlePOST(req: NextRequest, { params }: RouteParams) {
  const authz = requireAuthorizedTenant({ headers: req.headers, nextUrl: req.nextUrl });
  if (!authz.ok) {
    return NextResponse.json({ error: authz.error }, { status: authz.status });
  }
  const { id: tenantId } = await params;
  const auth = authorize(req, tenantId);
  if (!auth.ok) return auth.res;

  // The same path as the New User form (src/lib/admin/member-onboarding.ts):
  // { email, roleId } plus, optionally, the profile, department and module access.
  let bodyRaw: unknown;
  try { bodyRaw = stripTenantOwnershipFields(await req.json()); } catch { return NextResponse.json({ ok: false, error: 'Invalid JSON' }, { status: 400 }); }
  const parsed = parseNewMember(bodyRaw, { requireName: false });
  if (!parsed.ok) return NextResponse.json({ ok: false, error: parsed.error }, { status: parsed.status });

  try {
    const inviter = await sessionUser(req.headers).catch(() => null);
    const r = await inviteMember(req.headers, tenantId, { userId: auth.userId, name: inviter?.name, email: inviter?.email }, parsed.value);
    if (!r.ok) return NextResponse.json({ ok: false, error: r.error }, { status: r.status });
    return NextResponse.json({
      ok: true,
      emailed: r.emailed,
      reason: r.reason,
      // Caller may still need the URL when SMTP isn't configured (dev environments).
      acceptUrl: r.acceptUrl,
    });
  } catch (err) {
    captureException(err, { context: 'admin.invitations.post' });
    return NextResponse.json({ ok: false, error: 'Failed to create invitation' }, { status: 500 });
  }
}

// Privileged writes are always audited (src/lib/audited-action.ts).
export const POST = withAuditedAction(handlePOST);
