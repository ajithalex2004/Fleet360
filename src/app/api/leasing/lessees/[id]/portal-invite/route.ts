export const dynamic = 'force-dynamic';

/**
 * POST /api/leasing/lessees/[id]/portal-invite
 *
 * Staff-facing: invites a lessee contact to the leasing self-service
 * portal. Creates (or reuses) a lessee_portal_users row for the given
 * email, issues a single-use invitation token, and emails a setup link.
 *
 * Body: { email?, fullName? } — defaults to the Lessee's own email/name
 * if omitted (the common case: inviting the lessee's own contact email).
 *
 * Tenant scoping: requires x-tenant-id (staff session). Verifies the
 * lessee belongs to the caller's tenant before inviting.
 */

import { NextRequest, NextResponse } from 'next/server';
import { requireAuthorizedTenant } from '@/lib/tenant-context';
import { prisma } from '@/lib/prisma';
import {
  createPortalUser,
  findPortalUserByEmail,
  listPortalUsersByLessee,
} from '@/lib/leasing-portal/portal-users-store';
import { createInvitation, sendInvitationEmail } from '@/lib/leasing-portal/invitations';

export async function POST(req: NextRequest, props: { params: Promise<{ id: string }> }) {
  const params = await props.params;
  const authz = requireAuthorizedTenant(req);
  if (!authz.ok) {
    return NextResponse.json({ error: authz.error }, { status: authz.status });
  }
  const { tenantId } = authz;

  try {
    const lessee = await prisma.lessee.findFirst({
      where: { id: params.id, tenantId },
      select: { id: true, name: true, email: true },
    });
    if (!lessee) {
      return NextResponse.json({ error: 'Lessee not found' }, { status: 404 });
    }

    const body = await req.json().catch(() => ({})) as { email?: string; fullName?: string };
    const email = (body.email ?? lessee.email ?? '').trim().toLowerCase();
    if (!email) {
      return NextResponse.json(
        { error: 'No email on file for this lessee — supply one in the request body.' },
        { status: 400 },
      );
    }

    const existingAnywhere = await findPortalUserByEmail(email);
    if (existingAnywhere && existingAnywhere.tenantId !== tenantId) {
      return NextResponse.json(
        { error: 'This email is already registered to a portal account in a different tenant.' },
        { status: 409 },
      );
    }

    let portalUser = existingAnywhere && existingAnywhere.lesseeId === lessee.id
      ? existingAnywhere
      : (await listPortalUsersByLessee(tenantId, lessee.id)).find(u => u.email === email) ?? null;

    if (!portalUser) {
      portalUser = await createPortalUser({
        tenantId,
        lesseeId: lessee.id,
        email,
        fullName: body.fullName ?? null,
        role: 'LESSEE_ADMIN',
      });
    } else if (portalUser.hasPassword) {
      return NextResponse.json(
        { error: 'This lessee contact already has an active portal account.' },
        { status: 409 },
      );
    }

    const invitedByUserId = req.headers.get('x-user-id') ?? 'unknown';
    const invitation = await createInvitation({
      tenantId,
      portalUserId: portalUser.id,
      invitedByUserId,
    });

    const baseUrl = process.env.NEXT_PUBLIC_APP_URL ?? new URL(req.url).origin;
    const emailResult = await sendInvitationEmail({
      recipientEmail: email,
      recipientName: body.fullName ?? null,
      lesseeName: lessee.name,
      rawToken: invitation.rawToken,
      baseUrl,
      expiresAt: invitation.expiresAt,
    });

    return NextResponse.json({
      ok: true,
      portalUserId: portalUser.id,
      email,
      emailSent: emailResult.ok,
      emailReason: emailResult.ok ? null : emailResult.reason,
      // Always returned so staff can copy/paste the link if email delivery
      // isn't configured — same fallback the setup flow needs either way.
      setupUrl: `${baseUrl.replace(/\/$/, '')}/leasing-portal/setup?token=${encodeURIComponent(invitation.rawToken)}`,
    });
  } catch (e) {
    console.error('[leasing/lessees/portal-invite]', e);
    return NextResponse.json({ error: 'Failed to send portal invitation' }, { status: 500 });
  }
}
