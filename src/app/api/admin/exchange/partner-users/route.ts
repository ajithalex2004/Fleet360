export const dynamic = 'force-dynamic';

import { NextRequest, NextResponse } from 'next/server';
import { requireAuthorizedTenant, stripTenantOwnershipFields } from '@/lib/tenant-context';
import { isSuperAdmin } from '@/lib/admin-access';
import { prisma } from '@/lib/prisma';
import { withPlatformAdmin } from '@/lib/rls';
import { logAudit } from '@/lib/audit';
import {
  exchangeNotProvisionedResponse,
  isExchangeNotProvisioned,
  PARTNER_ROLES,
  type PartnerRole,
} from '@/lib/exchange/partner-auth';

export const runtime = 'nodejs';

/**
 * Partner memberships: which users act for which transport partner in the
 * Exchange marketplace (partner_users). Platform administrators only — this
 * route is not in ADMIN_ROUTE_POLICY, so middleware requires SUPER_ADMIN.
 *
 * GET    /api/admin/exchange/partner-users?partnerId=…   list a partner's members
 * POST   /api/admin/exchange/partner-users               { partnerId, email, role? }
 * DELETE /api/admin/exchange/partner-users?id=…          remove a membership
 */
/** Runs `fn`; a missing Exchange table becomes the 503 not-provisioned response. */
async function notProvisionedAware<T>(fn: () => Promise<T>): Promise<{ value: T } | { response: NextResponse }> {
  try {
    return { value: await fn() };
  } catch (err) {
    if (isExchangeNotProvisioned(err)) return { response: exchangeNotProvisionedResponse() };
    throw err;
  }
}

export async function GET(req: NextRequest) {
  // Middleware already requires SUPER_ADMIN for this unlisted admin route;
  // checked again here so the handler is safe on its own.
  const authz = requireAuthorizedTenant({ headers: req.headers });
  if (!authz.ok) return NextResponse.json({ error: authz.error }, { status: authz.status });
  if (!isSuperAdmin(req.headers)) return NextResponse.json({ error: 'Platform administrators only' }, { status: 403 });
  const partnerId = req.nextUrl.searchParams.get('partnerId');
  if (!partnerId) return NextResponse.json({ error: 'partnerId is required' }, { status: 400 });

  const membersRun = await notProvisionedAware(() => withPlatformAdmin(prisma, (tx) =>
    tx.partnerUser.findMany({
      where: { partnerId },
      select: {
        id: true,
        role: true,
        createdAt: true,
        user: { select: { id: true, email: true, username: true, isActive: true } },
      },
      orderBy: { createdAt: 'asc' },
    }),
  ));
  if ('response' in membersRun) return membersRun.response;
  const members = membersRun.value;
  return NextResponse.json({ members });
}

export async function POST(req: NextRequest) {
  // Middleware already requires SUPER_ADMIN for this unlisted admin route;
  // checked again here so the handler is safe on its own.
  const authz = requireAuthorizedTenant({ headers: req.headers });
  if (!authz.ok) return NextResponse.json({ error: authz.error }, { status: authz.status });
  if (!isSuperAdmin(req.headers)) return NextResponse.json({ error: 'Platform administrators only' }, { status: 403 });
  const body = stripTenantOwnershipFields(await req.json().catch(() => ({}))) as Record<string, unknown>;
  const partnerId = typeof body.partnerId === 'string' ? body.partnerId : '';
  const email = typeof body.email === 'string' ? body.email.trim().toLowerCase() : '';
  const role = (typeof body.role === 'string' ? body.role : 'PARTNER_OPERATIONS') as PartnerRole;

  if (!partnerId || !email) {
    return NextResponse.json({ error: 'partnerId and email are required' }, { status: 400 });
  }
  if (!(PARTNER_ROLES as readonly string[]).includes(role)) {
    return NextResponse.json({ error: `role must be one of ${PARTNER_ROLES.join(', ')}` }, { status: 400 });
  }

  const resultRun = await notProvisionedAware(() => withPlatformAdmin(prisma, async (tx) => {
    const partner = await tx.transportPartner.findFirst({ where: { id: partnerId, deletedAt: null }, select: { id: true, legalName: true } });
    if (!partner) return { status: 404 as const, error: 'Transport partner not found' };
    const user = await tx.user.findFirst({ where: { email: { equals: email, mode: 'insensitive' } }, select: { id: true, email: true, isActive: true } });
    if (!user) return { status: 404 as const, error: 'No user with that email' };
    if (!user.isActive) return { status: 409 as const, error: 'That user is deactivated' };

    const membership = await tx.partnerUser.upsert({
      where: { partnerId_userId: { partnerId, userId: user.id } },
      create: { partnerId, userId: user.id, role },
      update: { role },
      select: { id: true, partnerId: true, userId: true, role: true },
    });
    return { status: 200 as const, membership, partner, user };
  }));
  if ('response' in resultRun) return resultRun.response;
  const result = resultRun.value;

  if ('error' in result) return NextResponse.json({ error: result.error }, { status: result.status });

  await logAudit({
    entityType: 'PartnerUser',
    entityId: result.membership.id,
    action: 'UPDATE',
    details: `Linked ${result.user.email} to partner ${result.partner.legalName} as ${role}`,
    userId: req.headers.get('x-user-id') ?? undefined,
  });

  return NextResponse.json({ membership: result.membership });
}

export async function DELETE(req: NextRequest) {
  // Middleware already requires SUPER_ADMIN for this unlisted admin route;
  // checked again here so the handler is safe on its own.
  const authz = requireAuthorizedTenant({ headers: req.headers });
  if (!authz.ok) return NextResponse.json({ error: authz.error }, { status: authz.status });
  if (!isSuperAdmin(req.headers)) return NextResponse.json({ error: 'Platform administrators only' }, { status: 403 });
  const id = req.nextUrl.searchParams.get('id');
  if (!id) return NextResponse.json({ error: 'id is required' }, { status: 400 });

  const removedRun = await notProvisionedAware(() => withPlatformAdmin(prisma, async (tx) => {
    const membership = await tx.partnerUser.findUnique({ where: { id }, select: { id: true, partnerId: true, userId: true } });
    if (membership) await tx.partnerUser.delete({ where: { id } });
    return membership;
  }));
  if ('response' in removedRun) return removedRun.response;
  const removed = removedRun.value;
  if (!removed) return NextResponse.json({ error: 'Membership not found' }, { status: 404 });

  await logAudit({
    entityType: 'PartnerUser',
    entityId: removed.id,
    action: 'DELETE',
    details: `Removed user ${removed.userId} from partner ${removed.partnerId}`,
    userId: req.headers.get('x-user-id') ?? undefined,
  });

  return NextResponse.json({ ok: true });
}
