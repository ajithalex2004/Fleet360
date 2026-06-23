/**
 * /api/admin/tenants/[id]/invitations
 *
 * GET   — list invitations for a tenant (active + used + revoked)
 * POST  — invite a user. Body: { email, roleId }
 *
 * Authorization:
 *  - SUPER_ADMIN: may invite into any tenant
 *  - TENANT_ADMIN: may only invite into their own tenant
 */

import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import {
  ensureInvitationTable, generateInvitationToken, INVITATION_TTL_DAYS,
} from '@/lib/invitations';
import { requireUnderQuota } from '@/lib/plan-limits';
import type { PlanCode } from '@/lib/billing';
import { sendEmail } from '@/lib/email';
import { captureException } from '@/lib/sentry';
import { requireAdminPermission, resolveTenantBoundary } from '@/lib/admin-policy';
import { recordAdminChange } from '@/lib/admin-change-history';

export const runtime = 'nodejs';

interface RouteParams { params: Promise<{ id: string }>; }

export async function GET(req: NextRequest, { params }: RouteParams) {
  const { id } = await params;
  const auth = await requireAdminPermission(req, 'view', 'users');
  if (auth instanceof NextResponse) return auth;
  const tenantId = resolveTenantBoundary(auth.ctx, id);
  if (tenantId instanceof NextResponse) return tenantId;

  await ensureInvitationTable();

  const rows = await prisma.$queryRawUnsafe<Array<{
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
  );

  const now = new Date();
  return NextResponse.json({
    ok: true,
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

export async function POST(req: NextRequest, { params }: RouteParams) {
  const { id } = await params;
  const auth = await requireAdminPermission(req, 'create', 'users');
  if (auth instanceof NextResponse) return auth;
  const tenantId = resolveTenantBoundary(auth.ctx, id);
  if (tenantId instanceof NextResponse) return tenantId;

  let body: { email?: string; roleId?: string };
  try { body = await req.json(); } catch { return NextResponse.json({ ok: false, error: 'Invalid JSON' }, { status: 400 }); }
  const email  = String(body.email ?? '').trim().toLowerCase();
  const roleId = String(body.roleId ?? '').trim();

  if (!email || !/.+@.+\..+/.test(email)) {
    return NextResponse.json({ ok: false, error: 'A valid email is required.' }, { status: 400 });
  }
  if (!roleId) {
    return NextResponse.json({ ok: false, error: 'roleId is required.' }, { status: 400 });
  }

  // Verify the role belongs to this tenant (or is global with tenant_id NULL).
  const role = await prisma.role.findFirst({
    where: { id: roleId, OR: [{ tenantId }, { tenantId: null }] },
    select: { id: true, name: true, code: true },
  });
  if (!role) return NextResponse.json({ ok: false, error: 'Role not found for this tenant.' }, { status: 400 });

  const tenant = await prisma.tenant.findUnique({
    where: { id: tenantId },
    select: { id: true, name: true, isActive: true },
  });
  if (!tenant || !tenant.isActive) {
    return NextResponse.json({ ok: false, error: 'Tenant not found or inactive.' }, { status: 400 });
  }

  // Block re-invitation when an active membership already exists.
  const existing = await prisma.userTenant.findFirst({
    where: { tenantId, isActive: true, user: { email } },
    select: { id: true },
  });
  if (existing) {
    return NextResponse.json({ ok: false, error: `${email} is already a member of this organisation.` }, { status: 400 });
  }

  // Quota: count active members + outstanding pending invitations against maxUsers.
  const tenantPlan = (req.headers.get('x-tenant-plan') ?? 'TRIAL') as PlanCode;
  const [activeCount, pendingRows] = await Promise.all([
    prisma.userTenant.count({ where: { tenantId, isActive: true } }),
    prisma.$queryRawUnsafe<{ c: bigint }[]>(
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
    await ensureInvitationTable();

    const beforeRows = await prisma.$queryRawUnsafe<Array<{
      id: string; email: string; role_id: string; revoked: boolean; used_at: string | null; expires_at: string;
    }>>(
      `SELECT id::text, email, role_id, revoked, used_at::text, expires_at::text
         FROM tenant_invitations
        WHERE tenant_id = $1 AND LOWER(email) = $2
        ORDER BY created_at DESC
        LIMIT 5`,
      tenantId, email,
    ).catch(() => []);

    // Single active invitation per email × tenant — revoke any prior live one.
    await prisma.$executeRawUnsafe(
      `UPDATE tenant_invitations
         SET revoked = TRUE
       WHERE tenant_id = $1 AND LOWER(email) = $2
         AND used_at IS NULL AND revoked = FALSE AND expires_at > NOW()`,
      tenantId, email,
    ).catch(() => {});

    const { token, hash } = generateInvitationToken();
    const expiresAt = new Date(Date.now() + INVITATION_TTL_DAYS * 86_400_000);

    const inserted = await prisma.$queryRawUnsafe<Array<{
      id: string; tenant_id: string; email: string; role_id: string;
      invited_by_user_id: string | null; expires_at: string; revoked: boolean;
    }>>(
      `INSERT INTO tenant_invitations
         (tenant_id, email, role_id, token_hash, invited_by_user_id, expires_at)
       VALUES ($1, $2, $3, $4, $5, $6)
       RETURNING id::text, tenant_id, email, role_id, invited_by_user_id, expires_at::text, revoked`,
      tenantId, email, roleId, hash, auth.ctx.userId, expiresAt,
    );
    const invitation = inserted[0] ?? null;

    const baseUrl   = process.env.NEXT_PUBLIC_APP_URL ?? 'http://localhost:3000';
    const acceptUrl = `${baseUrl}/invitation/${encodeURIComponent(token)}`;

    const send = await sendEmail({
      to: email,
      subject: `You've been invited to ${tenant.name} on Fleet360`,
      text: [
        `You've been invited to join ${tenant.name} as ${role.name}.`,
        '',
        `Accept the invite (valid for ${INVITATION_TTL_DAYS} days):`,
        acceptUrl,
        '',
        'If you didn\'t expect this, you can safely ignore the email.',
      ].join('\n'),
      html:
        `<p>You&rsquo;ve been invited to join <strong>${escapeHtml(tenant.name)}</strong> as <strong>${escapeHtml(role.name)}</strong> on Fleet360.</p>` +
        `<p><a href="${acceptUrl}" style="display:inline-block;padding:10px 18px;background:#2563eb;color:white;border-radius:8px;text-decoration:none">Accept invitation</a></p>` +
        `<p style="color:#666;font-size:12px">Or copy this link: <code>${acceptUrl}</code><br/>Valid for ${INVITATION_TTL_DAYS} days.</p>` +
        `<p style="color:#666;font-size:12px">If you didn&rsquo;t expect this, ignore the email.</p>`,
    });

    await recordAdminChange({
      req,
      ctx: auth.ctx,
      tenantId,
      entityType: 'Invitation',
      entityId: invitation?.id ?? null,
      entityName: email,
      action: 'CREATE',
      before: beforeRows,
      after: { ...invitation, emailSent: send.sent, emailReason: send.reason ?? null },
      summary: `Invitation sent to ${email} as ${role.name}. Email send: ${send.sent ? 'OK' : `failed (${send.reason ?? 'unknown'})`}.`,
    });

    return NextResponse.json({
      ok: true,
      invitationId: invitation?.id,
      emailed: send.sent,
      reason:  send.sent ? undefined : send.reason,
      // Caller may still need the URL when SMTP isn't configured (dev environments).
      acceptUrl: send.sent ? undefined : acceptUrl,
    });
  } catch (err) {
    captureException(err, { context: 'admin.invitations.post' });
    return NextResponse.json({ ok: false, error: 'Failed to create invitation' }, { status: 500 });
  }
}

function escapeHtml(s: string): string {
  return s.replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]!));
}
