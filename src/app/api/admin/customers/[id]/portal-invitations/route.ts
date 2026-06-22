/**
 * POST /api/admin/customers/[id]/portal-invitations
 *
 * Tenant-operator action: invite a portal user for a given customer.
 *
 *   Body: { email, fullName?, phone?, role?: 'SHIPPER_USER' | 'SHIPPER_ADMIN' }
 *
 *   Flow:
 *     1. Validate the operator owns the customer (tenant match)
 *     2. Find or create a portal user row (idempotent on email per customer)
 *     3. Create a fresh invitation token (existing pending tokens for this
 *        user are NOT invalidated — operator may want to resend)
 *     4. Send the setup-link email via the tenant's SMTP integration
 *     5. Return { ok, portalUser, invitationLink } where the link is
 *        returned so operator can copy/share manually if email fails
 *
 * Auth: requires a tenant operator session.
 */

import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import {
  createPortalUser, listPortalUsersByCustomer,
} from '@/lib/shipper-portal/portal-users-store';
import {
  createInvitation, sendInvitationEmail,
} from '@/lib/shipper-portal/invitations';

export const runtime = 'nodejs';

export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const tenantId = req.headers.get('x-tenant-id');
  const userId = req.headers.get('x-user-id');
  if (!tenantId || !userId) {
    return NextResponse.json({ error: 'Not authenticated' }, { status: 401 });
  }

  try {
    const { id: customerId } = await params;

    // Verify the customer belongs to this tenant.
    const customerRows = await prisma.$queryRawUnsafe<Array<{ id: string; name_en: string }>>(
      `SELECT id, name_en FROM customers
        WHERE id = $1 AND tenant_id = $2 AND deleted_at IS NULL
        LIMIT 1`,
      customerId, tenantId,
    ).catch(() => []);
    if (!customerRows[0]) {
      return NextResponse.json({ error: 'Customer not found' }, { status: 404 });
    }
    const customerName = customerRows[0].name_en;

    const body = await req.json().catch(() => ({})) as {
      email?: string; fullName?: string; phone?: string;
      role?: 'SHIPPER_USER' | 'SHIPPER_ADMIN';
    };
    const email = String(body.email ?? '').trim().toLowerCase();
    if (!email || !/.+@.+\..+/.test(email)) {
      return NextResponse.json({ error: 'Valid email required' }, { status: 400 });
    }

    // Idempotent on (tenant, email). If a portal user already exists for
    // this email under any customer in this tenant, refuse — the operator
    // probably means to resend rather than create a duplicate identity.
    const existing = (await listPortalUsersByCustomer(tenantId, customerId))
      .find(u => u.email.toLowerCase() === email);

    let portalUser;
    if (existing) {
      portalUser = existing;
    } else {
      try {
        portalUser = await createPortalUser({
          tenantId, customerId, email,
          fullName: body.fullName,
          phone: body.phone,
          role: body.role ?? 'SHIPPER_USER',
        });
      } catch (e: unknown) {
        const err = e as { code?: string };
        if (err?.code === '23505') {
          return NextResponse.json({
            error: 'A portal user with this email already exists under a different customer in this tenant.',
          }, { status: 409 });
        }
        throw e;
      }
    }

    // Create a fresh invitation token.
    const invitation = await createInvitation({
      tenantId, portalUserId: portalUser.id, invitedByUserId: userId,
    });

    // Send the email (non-fatal on SMTP failure — operator can copy the link).
    const baseUrl = process.env.NEXT_PUBLIC_APP_URL
      ?? req.headers.get('origin')
      ?? `https://${req.headers.get('host') ?? 'localhost:3000'}`;
    const emailResult = await sendInvitationEmail({
      tenantId,
      recipientEmail: portalUser.email,
      recipientName: portalUser.fullName,
      customerName,
      rawToken: invitation.rawToken,
      baseUrl,
      expiresAt: invitation.expiresAt,
    });

    return NextResponse.json({
      ok: true,
      portalUser: {
        id: portalUser.id,
        email: portalUser.email,
        fullName: portalUser.fullName,
        role: portalUser.role,
        isActive: portalUser.isActive,
      },
      invitation: {
        id: invitation.id,
        expiresAt: invitation.expiresAt,
        // Raw token is returned ONLY here, ONLY to the operator that created
        // it, so they can copy the link if email fails. Never echoed elsewhere.
        setupUrl: `${baseUrl.replace(/\/$/, '')}/shipper-portal/setup?token=${encodeURIComponent(invitation.rawToken)}`,
      },
      emailSent: emailResult.ok,
      emailError: emailResult.ok ? null : (emailResult as { reason: string }).reason,
    }, { status: 201 });
  } catch (e) {
    console.error('[admin/customers/portal-invitations] POST', e);
    return NextResponse.json({ error: 'Failed to create invitation' }, { status: 500 });
  }
}

/**
 * GET /api/admin/customers/[id]/portal-invitations
 * Lists portal users for the customer so the operator can see who's been
 * invited / who's active / who's pending.
 */
export async function GET(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const tenantId = req.headers.get('x-tenant-id');
  if (!tenantId) return NextResponse.json({ error: 'Not authenticated' }, { status: 401 });

  try {
    const { id: customerId } = await params;
    const users = await listPortalUsersByCustomer(tenantId, customerId);
    return NextResponse.json({ users });
  } catch (e) {
    console.error('[admin/customers/portal-invitations] GET', e);
    return NextResponse.json({ error: 'Failed to list portal users' }, { status: 500 });
  }
}
