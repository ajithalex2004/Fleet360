export const dynamic = 'force-dynamic';

import { NextRequest, NextResponse } from 'next/server';
import { requireAuthorizedTenant, stripTenantOwnershipFields } from '@/lib/tenant-context';
import { isSuperAdmin } from '@/lib/admin-access';
import { prisma } from '@/lib/prisma';
import { withPlatformAdmin } from '@/lib/rls';
import { logAudit } from '@/lib/audit';
import { appUrl, sendTemplatedEmail } from '@/lib/email-templates';
import { requireUnderQuota } from '@/lib/plan-limits';
import { generateInvitationToken, INVITATION_TTL_DAYS } from '@/lib/invitations';
import { notProvisionedAware, PARTNER_ROLES } from '@/lib/exchange/partner-auth';
import { findActiveTenant, isPartnerRole } from '@/lib/exchange/partner-onboarding';
import { PARTNER_TENANT_ROLE } from '@/lib/exchange/partner-role';
import { withAuditedAction } from '@/lib/audited-action';

export const runtime = 'nodejs';

/**
 * Invitations that create a transport partner's users.
 *
 * GET    /api/admin/exchange/partners/:id/invitations          the partner's invitations
 * POST   /api/admin/exchange/partners/:id/invitations          { email, partnerRole }
 * DELETE /api/admin/exchange/partners/:id/invitations?id=…     revoke a pending invitation
 *
 * POST emails an invitation into the partner's onboarding tenant with the
 * Partner tenant role (PARTNER: partner portal only, see
 * src/lib/exchange/partner-role.ts). Accepting it creates the user in that
 * tenant's User Master and links them to the partner as `partnerRole`
 * (see src/lib/exchange/partner-onboarding.ts). Someone who already has a
 * Fleet360 account is linked with /api/admin/exchange/partner-users instead.
 * Platform administrators only (ADMIN_ROUTE_POLICY).
 */

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

type Params = { params: Promise<{ id: string }> };

// Middleware already requires SUPER_ADMIN for these platform admin routes;
// checked again so each handler is safe on its own.
function notPlatformAdmin(req: NextRequest): NextResponse | null {
  return isSuperAdmin(req.headers) ? null : NextResponse.json({ error: 'Platform administrators only' }, { status: 403 });
}

export async function GET(req: NextRequest, props: Params) {
  const { id: partnerId } = await props.params;
  const authz = requireAuthorizedTenant({ headers: req.headers });
  if (!authz.ok) return NextResponse.json({ error: authz.error }, { status: authz.status });
  const deny = notPlatformAdmin(req);
  if (deny) return deny;

  const rows = await withPlatformAdmin(prisma, (tx) => tx.$queryRawUnsafe<Array<{
    id: string; email: string; partner_role: string | null; role_name: string | null; tenant_name: string | null;
    expires_at: string; used_at: string | null; revoked: boolean; created_at: string;
  }>>(
    `SELECT i.id::text, i.email, i.partner_role, r.name AS role_name, t.name AS tenant_name,
            i.expires_at::text, i.used_at::text, i.revoked, i.created_at::text
       FROM tenant_invitations i
       LEFT JOIN roles r   ON r.id = i.role_id
       LEFT JOIN tenants t ON t.id = i.tenant_id
      WHERE i.partner_id = $1
      ORDER BY i.created_at DESC
      LIMIT 100`,
    partnerId,
  ));

  const now = Date.now();
  return NextResponse.json({
    invitations: rows.map((r) => ({
      id: r.id,
      email: r.email,
      partnerRole: r.partner_role,
      tenantRoleName: r.role_name,
      tenantName: r.tenant_name,
      expiresAt: r.expires_at,
      createdAt: r.created_at,
      status: r.used_at ? 'accepted' : r.revoked ? 'revoked' : new Date(r.expires_at).getTime() < now ? 'expired' : 'pending',
    })),
  });
}

async function handlePOST(req: NextRequest, props: Params) {
  const { id: partnerId } = await props.params;
  const authz = requireAuthorizedTenant({ headers: req.headers });
  if (!authz.ok) return NextResponse.json({ error: authz.error }, { status: authz.status });
  const deny = notPlatformAdmin(req);
  if (deny) return deny;
  const inviterId = req.headers.get('x-user-id');

  const body = stripTenantOwnershipFields(await req.json().catch(() => ({}))) as Record<string, unknown>;
  const email = typeof body.email === 'string' ? body.email.trim().toLowerCase() : '';
  const partnerRole = body.partnerRole;

  if (!EMAIL_RE.test(email)) return NextResponse.json({ error: 'A valid email is required' }, { status: 400 });
  if (!isPartnerRole(partnerRole)) {
    return NextResponse.json({ error: `partnerRole must be one of ${PARTNER_ROLES.join(', ')}` }, { status: 400 });
  }

  const run = await notProvisionedAware(() => withPlatformAdmin(prisma, async (tx) => {
    const partner = await tx.transportPartner.findFirst({
      where: { id: partnerId, deletedAt: null },
      select: { id: true, legalName: true, onboardedByTenantId: true },
    });
    if (!partner) return { status: 404 as const, error: 'Transport partner not found' };
    if (!partner.onboardedByTenantId) {
      return { status: 409 as const, error: 'Set the tenant that onboarded this partner before inviting its users' };
    }
    const tenant = await findActiveTenant(tx, partner.onboardedByTenantId);
    if (!tenant) return { status: 409 as const, error: 'The onboarding tenant is not active' };

    // The Partner role: the tenant's own copy if it has one, else the
    // platform template (migration 20260927140000_partner_tenant_role).
    const partnerRoles = await tx.role.findMany({
      where: { code: PARTNER_TENANT_ROLE, OR: [{ tenantId: tenant.id }, { tenantId: null }] },
      select: { id: true, name: true, code: true, tenantId: true },
    });
    const role = partnerRoles.find((r) => r.tenantId === tenant.id) ?? partnerRoles.find((r) => r.tenantId === null);
    if (!role) {
      return { status: 409 as const, error: 'The Partner role is not set up yet (migration 20260927140000_partner_tenant_role)' };
    }

    const existingUser = await tx.user.findFirst({
      where: { email: { equals: email, mode: 'insensitive' } },
      select: { id: true },
    });
    if (existingUser) {
      return { status: 409 as const, error: `${email} already has a Fleet360 account. Use Link user instead.` };
    }

    // Quota: the tenant's active members plus its outstanding invitations.
    const [active, pending] = await Promise.all([
      tx.userTenant.count({ where: { tenantId: tenant.id, isActive: true } }),
      tx.$queryRawUnsafe<Array<{ c: bigint }>>(
        `SELECT COUNT(*)::bigint AS c FROM tenant_invitations
          WHERE tenant_id = $1 AND used_at IS NULL AND revoked = FALSE AND expires_at > NOW()
            AND LOWER(email) <> $2`,
        tenant.id, email,
      ),
    ]);
    const quota = requireUnderQuota({
      plan: tenant.plan ?? 'STANDARD', resource: 'maxUsers', current: active + Number(pending[0]?.c ?? 0),
    });
    if (quota) return { status: 402 as const, error: `${tenant.name} has reached its user limit`, quota };

    // One live invitation per email and tenant.
    await tx.$executeRawUnsafe(
      `UPDATE tenant_invitations SET revoked = TRUE
        WHERE tenant_id = $1 AND LOWER(email) = $2
          AND used_at IS NULL AND revoked = FALSE AND expires_at > NOW()`,
      tenant.id, email,
    );
    const { token, hash } = generateInvitationToken();
    const expiresAt = new Date(Date.now() + INVITATION_TTL_DAYS * 86_400_000);
    await tx.$executeRawUnsafe(
      `INSERT INTO tenant_invitations
         (tenant_id, email, role_id, token_hash, invited_by_user_id, expires_at, partner_id, partner_role)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
      tenant.id, email, role.id, hash, inviterId, expiresAt, partner.id, partnerRole,
    );
    return { status: 200 as const, partner, tenant, role, token };
  }));
  if ('response' in run) return run.response;
  const result = run.value;
  if ('quota' in result && result.quota) return result.quota;
  if ('error' in result) return NextResponse.json({ error: result.error }, { status: result.status });

  const { partner, tenant, role, token } = result;
  const acceptUrl = appUrl(`/invitation/${encodeURIComponent(token)}`);
  // Platform wording (Admin > Email templates > Exchange), in the language
  // of the tenant the account is created under.
  const send = await sendTemplatedEmail({
    tenantId: tenant.id,
    key: 'exchange.partner_invitation',
    to: email,
    values: {
      partnerName: partner.legalName,
      organisationName: tenant.name,
      acceptUrl,
      validDays: String(INVITATION_TTL_DAYS),
    },
  });

  await logAudit({
    tenantId: tenant.id, tenantName: tenant.name,
    entityType: 'PartnerUser',
    entityName: email,
    action: 'CREATE',
    details: `Invited ${email} to ${partner.legalName} as ${partnerRole} (${role.name} in ${tenant.name}). Email send: ${send.sent ? 'OK' : `failed (${send.reason ?? 'unknown'})`}.`,
    userId: inviterId ?? undefined,
  });

  return NextResponse.json({
    ok: true,
    emailed: send.sent,
    reason: send.sent ? undefined : send.reason,
    // When email isn't configured the administrator can pass the link on.
    acceptUrl: send.sent ? undefined : acceptUrl,
  });
}

async function handleDELETE(req: NextRequest, props: Params) {
  const { id: partnerId } = await props.params;
  const authz = requireAuthorizedTenant({ headers: req.headers });
  if (!authz.ok) return NextResponse.json({ error: authz.error }, { status: authz.status });
  const deny = notPlatformAdmin(req);
  if (deny) return deny;
  const id = req.nextUrl.searchParams.get('id') ?? '';
  if (!/^[0-9a-f-]{36}$/i.test(id)) return NextResponse.json({ error: 'id is required' }, { status: 400 });

  const revoked = await withPlatformAdmin(prisma, (tx) => tx.$executeRawUnsafe(
    `UPDATE tenant_invitations SET revoked = TRUE
      WHERE id = $1::uuid AND partner_id = $2 AND used_at IS NULL AND revoked = FALSE`,
    id, partnerId,
  ));
  if (!revoked) return NextResponse.json({ error: 'No pending invitation with that id' }, { status: 404 });

  await logAudit({
    entityType: 'PartnerUser',
    entityId: id,
    action: 'DELETE',
    details: `Revoked partner invitation ${id} for partner ${partnerId}`,
    userId: req.headers.get('x-user-id') ?? undefined,
  });
  return NextResponse.json({ ok: true });
}

// Privileged writes are always audited (src/lib/audited-action.ts).
export const POST = withAuditedAction(handlePOST);
export const DELETE = withAuditedAction(handleDELETE);
