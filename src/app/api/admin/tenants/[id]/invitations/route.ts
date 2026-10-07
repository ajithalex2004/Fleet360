export const dynamic = 'force-dynamic';

/**
 * /api/admin/tenants/[id]/invitations
 *
 * GET   — list invitations for a tenant (active + used + revoked), plus the
 *         roles an invitation can grant: the tenant's own roles and the
 *         platform roles (Tenant Administrator, Fleet Manager, …).
 * POST  — invite a user. Body: { email, roleId }
 *
 * Authorization:
 *  - SUPER_ADMIN: may invite into any tenant
 *  - TENANT_ADMIN: may only invite into their own tenant
 */

import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { withPlatformAdmin, withTenantRls } from '@/lib/rls';
import {
  generateInvitationToken, INVITATION_TTL_DAYS,
} from '@/lib/invitations';
import { requireUnderQuota } from '@/lib/plan-limits';
import type { PlanCode } from '@/lib/billing';
import { appUrl, sendTemplatedEmail } from '@/lib/email-templates';
import { sessionUser } from '@/lib/session-user';
import { logAudit } from '@/lib/audit';
import { captureException } from '@/lib/sentry';

import { requireAuthorizedTenant, stripTenantOwnershipFields } from '@/lib/tenant-context';
import { checkGrantableRole } from '@/lib/admin-scope';
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

  let body: { email?: string; roleId?: string };
  try { const bodyRaw = await req.json(); body = stripTenantOwnershipFields(bodyRaw); } catch { return NextResponse.json({ ok: false, error: 'Invalid JSON' }, { status: 400 }); }
  const email  = String(body.email ?? '').trim().toLowerCase();
  const roleId = String(body.roleId ?? '').trim();

  if (!email || !/.+@.+\..+/.test(email)) {
    return NextResponse.json({ ok: false, error: 'A valid email is required.' }, { status: 400 });
  }
  if (!roleId) {
    return NextResponse.json({ ok: false, error: 'roleId is required.' }, { status: 400 });
  }

  // The invitation to email once it is saved (the email isn't sent while
  // the transaction is open).
  const created: { invite: { acceptUrl: string; roleName: string; tenantName: string } | null } = { invite: null };
  const response = await withTenantRls(prisma, tenantId, async (tx) => {
    // Verify the role belongs to this tenant (or is global with tenant_id NULL).
    const role = await tx.role.findFirst({
      where: { id: roleId, OR: [{ tenantId }, { tenantId: null }] },
      select: { id: true, name: true, code: true, tenantId: true },
    });
    if (!role) return NextResponse.json({ ok: false, error: 'Role not found for this tenant.' }, { status: 400 });
    const roleDenied = checkGrantableRole(req.headers, tenantId, role);
    if (roleDenied) return roleDenied;

    const tenant = await tx.tenant.findUnique({
      where: { id: tenantId },
      select: { id: true, name: true, isActive: true },
    });
    if (!tenant || !tenant.isActive) {
      return NextResponse.json({ ok: false, error: 'Tenant not found or inactive.' }, { status: 400 });
    }

    // Block re-invitation when an active membership already exists.
    const existing = await tx.userTenant.findFirst({
      where: { tenantId, isActive: true, user: { email } },
      select: { id: true },
    });
    if (existing) {
      return NextResponse.json({ ok: false, error: `${email} is already a member of this organisation.` }, { status: 400 });
    }

    // Quota: count active members + outstanding pending invitations against maxUsers.
    const tenantPlan = (req.headers.get('x-tenant-plan') ?? 'TRIAL') as PlanCode;
    const [activeCount, pendingRows] = await Promise.all([
      tx.userTenant.count({ where: { tenantId, isActive: true } }),
      tx.$queryRawUnsafe<{ c: bigint }[]>(
        `SELECT COUNT(*)::bigint AS c FROM tenant_invitations
         WHERE tenant_id = $1 AND used_at IS NULL AND revoked = FALSE AND expires_at > NOW()`,
        tenantId,
      ).catch(() => []),
    ]);
    const pending = pendingRows[0] ? Number(pendingRows[0].c) : 0;
    const quotaGate = requireUnderQuota({
      plan: tenantPlan, resource: 'maxUsers', current: activeCount + pending,
    });
    if (quotaGate) return quotaGate;

    try {
    
      // Single active invitation per email × tenant — revoke any prior live one.
      await tx.$executeRawUnsafe(
        `UPDATE tenant_invitations
           SET revoked = TRUE
         WHERE tenant_id = $1 AND LOWER(email) = $2
           AND used_at IS NULL AND revoked = FALSE AND expires_at > NOW()`,
        tenantId, email,
      ).catch(() => {});

      const { token, hash } = generateInvitationToken();
      const expiresAt = new Date(Date.now() + INVITATION_TTL_DAYS * 86_400_000);

      await tx.$executeRawUnsafe(
        `INSERT INTO tenant_invitations
           (tenant_id, email, role_id, token_hash, invited_by_user_id, expires_at)
         VALUES ($1, $2, $3, $4, $5, $6)`,
        tenantId, email, roleId, hash, auth.userId, expiresAt,
      );

      created.invite = {
        acceptUrl: appUrl(`/invitation/${encodeURIComponent(token)}`),
        roleName: role.name,
        tenantName: tenant.name,
      };
      return null;
      } catch (err) {
      captureException(err, { context: 'admin.invitations.post' });
      return NextResponse.json({ ok: false, error: 'Failed to create invitation' }, { status: 500 });
    }
  });
  const invite = created.invite;
  if (response || !invite) return response ?? NextResponse.json({ ok: false, error: 'Failed to create invitation' }, { status: 500 });

  // In the tenant's wording, name and language (Admin > Email templates).
  const inviter = await sessionUser(req.headers).catch(() => null);
  const send = await sendTemplatedEmail({
    tenantId,
    key: 'account.user_invitation',
    to: email,
    ...(inviter?.email ? { replyTo: inviter.email } : {}),
    values: {
      roleName: invite.roleName,
      invitedBy: inviter?.name ?? inviter?.email ?? '',
      acceptUrl: invite.acceptUrl,
      validDays: String(INVITATION_TTL_DAYS),
    },
  });

  void logAudit({
    tenantId, tenantName: invite.tenantName,
    userId: auth.userId,
    userRole: 'TENANT_ADMIN',
    entityType: 'Invitation',
    entityName: email,
    action: 'CREATE',
    details: `Invitation sent to ${email} as ${invite.roleName}. Email send: ${send.sent ? 'OK' : `failed (${send.reason ?? 'unknown'})`}.`,
  });

  return NextResponse.json({
    ok: true,
    emailed: send.sent,
    reason:  send.sent ? undefined : send.reason,
    // Caller may still need the URL when SMTP isn't configured (dev environments).
    acceptUrl: send.sent ? undefined : invite.acceptUrl,
  });
}

// Privileged writes are always audited (src/lib/audited-action.ts).
export const POST = withAuditedAction(handlePOST);
