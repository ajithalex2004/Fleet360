export const dynamic = 'force-dynamic';

/**
 * Staff B2B Portal User Management API — /api/rental/customers/[id]/portal-users
 *
 * Allows authorized RAC managers (`rental:approve:customers`) to manage B2B portal
 * users (`rac_portal_users`) and issue single-use SHA-256 setup invitations
 * (`rac_portal_invitations`) strictly for CORPORATE `RentalCustomer` accounts.
 */
import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { requireAuthorizedTenant, stripTenantOwnershipFields } from '@/lib/tenant-context';
import { prisma } from '@/lib/prisma';
import { sendEmail } from '@/lib/email';
import { withTenantRls } from '@/lib/rls';
import { runOutsideRlsScope } from '@/lib/rls-scope';
import { logAudit } from '@/lib/audit';
import { requireRentalPermission } from '@/lib/rental/rbac';
import {
  createRacPortalUser,
  deleteRacPortalUser,
  getRacPortalUserById,
  listRacPortalUsersByCustomer,
  setRacPortalUserActive,
  type RacPortalRole,
} from '@/lib/rac-portal/portal-users-store';
import { createRacInvitation } from '@/lib/rac-portal/invitations';

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const createBodySchema = z.object({
  email: z.string().trim().email(),
  fullName: z.string().trim().optional(),
  phone: z.string().trim().optional(),
  role: z
    .enum([
      'RAC_B2B_VIEWER',
      'RAC_B2B_BOOKER',
      'RAC_B2B_FINANCE',
      'RAC_B2B_ADMIN',
      'RAC_B2B_USER',
    ])
    .optional()
    .default('RAC_B2B_USER'),
});

const patchBodySchema = z.object({
  userId: z.string().uuid(),
  isActive: z.boolean().optional(),
  resendInvite: z.boolean().optional(),
});

async function verifyTenantCustomer(tenantId: string, customerId: string) {
  return withTenantRls(prisma, tenantId, (tx) =>
    tx.rentalCustomer.findFirst({
      where: { id: customerId, tenantId, deletedAt: null },
      select: { id: true, fullName: true, companyName: true, customerType: true },
    }),
  );
}

function resolveAppOrigin(req: NextRequest): string {
  const configured = (process.env.NEXT_PUBLIC_APP_URL || process.env.APP_URL || '').trim();
  const base = configured || req.nextUrl.origin;
  return base.replace(/\/$/, '');
}

/**
 * Attempts onboarding email delivery when SMTP / SendGrid is configured.
 * `rawToken` is NEVER returned directly; whenever email is not configured or delivery
 * is skipped/fails (`!emailDispatched`), `setupUrl` is returned to the authenticated
 * RAC manager so no invited B2B user is ever stranded without an activation link.
 */
async function dispatchAndBuildInvitationResponse(args: {
  req: NextRequest;
  inv: { id: string; rawToken: string; expiresAt: string };
  recipientEmail: string;
  recipientName?: string | null;
  companyName?: string | null;
  role: string;
}): Promise<{
  id: string;
  invited: true;
  expiresAt: string;
  emailDispatched: boolean;
  setupUrl?: string;
}> {
  const setupPath = '/rac-portal/setup?token=' + encodeURIComponent(args.inv.rawToken);
  const fullSetupUrl = `${resolveAppOrigin(args.req)}${setupPath}`;
  const greetingName = args.recipientName?.trim() || args.recipientEmail;
  const companyLabel = args.companyName?.trim() || 'your corporate account';

  let emailDispatched = false;
  try {
    const emailRes = await runOutsideRlsScope(() =>
      sendEmail({
        to: args.recipientEmail,
        subject: 'Fleet360 Corporate B2B Mobility Portal — Activate Your Account',
        text: [
          `Hello ${greetingName},`,
          '',
          `You have been invited to access the Fleet360 Corporate B2B Mobility Portal for ${companyLabel} (${args.role}).`,
          `Activate your account and set your password using this single-use link (valid until ${new Date(args.inv.expiresAt).toUTCString()}):`,
          fullSetupUrl,
          '',
          'If you were not expecting this invitation, please ignore this email.',
        ].join('\n'),
        html: `<div style="font-family:Arial,sans-serif;max-width:560px;line-height:1.5;color:#0f172a">
          <h2 style="margin:0 0 12px">Corporate B2B Mobility Portal Invitation</h2>
          <p>Hello <strong>${greetingName.replace(/[<>&"]/g, '')}</strong>,</p>
          <p>You have been invited to access the Fleet360 Corporate B2B Mobility Portal for <strong>${companyLabel.replace(/[<>&"]/g, '')}</strong> (${args.role}).</p>
          <p style="margin:20px 0">
            <a href="${fullSetupUrl}" style="display:inline-block;padding:12px 20px;background:#0891b2;color:#ffffff;text-decoration:none;border-radius:8px;font-weight:bold">
              Activate Corporate Portal Account
            </a>
          </p>
          <p style="font-size:12px;color:#475569">This single-use link expires in 7 days (${new Date(args.inv.expiresAt).toUTCString()}).</p>
        </div>`,
      }),
    );
    emailDispatched = Boolean(emailRes.sent);
  } catch (err) {
    console.warn('[portal-users] Invitation email dispatch failed/skipped:', err);
    emailDispatched = false;
  }

  return {
    id: args.inv.id,
    invited: true,
    expiresAt: args.inv.expiresAt,
    emailDispatched,
    ...(!emailDispatched ? { setupUrl: setupPath } : {}),
  };
}

/* ─── GET: List portal users for customer ─── */
export async function GET(req: NextRequest, props: { params: Promise<{ id: string }> }) {
  const params = await props.params;
  const authz = requireAuthorizedTenant(req);
  if (!authz.ok) {
    return NextResponse.json({ error: authz.error }, { status: authz.status });
  }
  const { tenantId } = authz;

  const denied = await requireRentalPermission(
    req.headers,
    tenantId,
    'view',
    'customers',
    req.nextUrl.pathname,
  );
  if (denied) return denied;

  try {
    const customer = await verifyTenantCustomer(tenantId, params.id);
    if (!customer) {
      return NextResponse.json({ error: 'Customer not found' }, { status: 404 });
    }

    const users = await listRacPortalUsersByCustomer(tenantId, params.id);
    return NextResponse.json({ users });
  } catch (err) {
    console.error('GET /api/rental/customers/[id]/portal-users error:', err);
    return NextResponse.json({ error: 'Failed to list portal users' }, { status: 500 });
  }
}

/* ─── POST: Create (or reuse) portal user & issue invitation (`rental:approve:customers`) ─── */
export async function POST(req: NextRequest, props: { params: Promise<{ id: string }> }) {
  const params = await props.params;
  const authz = requireAuthorizedTenant(req);
  if (!authz.ok) {
    return NextResponse.json({ error: authz.error }, { status: authz.status });
  }
  const { tenantId } = authz;

  const denied = await requireRentalPermission(
    req.headers,
    tenantId,
    'approve',
    'customers',
    req.nextUrl.pathname,
  );
  if (denied) return denied;

  const jsonRaw = await req.json().catch(() => null);
  const json = stripTenantOwnershipFields(
    (jsonRaw && typeof jsonRaw === 'object' ? jsonRaw : {}) as Record<string, unknown>,
  );
  const parsed = createBodySchema.safeParse(json);
  if (!parsed.success) {
    return NextResponse.json(
      {
        error: 'Validation failed',
        details: parsed.error.issues.map((i) => ({
          path: i.path.join('.'),
          message: i.message,
        })),
      },
      { status: 400 },
    );
  }
  const data = parsed.data;

  try {
    const customer = await verifyTenantCustomer(tenantId, params.id);
    if (!customer) {
      return NextResponse.json({ error: 'Customer not found' }, { status: 404 });
    }

    if (String(customer.customerType ?? '').toUpperCase() !== 'CORPORATE') {
      return NextResponse.json(
        {
          error: 'B2B portal users can only be provisioned for CORPORATE customers',
          code: 'CORPORATE_CUSTOMER_REQUIRED',
        },
        { status: 422 },
      );
    }

    const normalizedEmail = data.email.toLowerCase().trim();
    const existingForCustomer = await listRacPortalUsersByCustomer(tenantId, params.id);
    let user = existingForCustomer.find(
      (u) => u.email.toLowerCase() === normalizedEmail,
    );

    if (user) {
      if (!user.isActive) {
        await setRacPortalUserActive(tenantId, user.id, true);
        user = (await getRacPortalUserById(tenantId, user.id)) ?? user;
      }
    } else {
      try {
        user = await createRacPortalUser({
          tenantId,
          customerId: params.id,
          email: normalizedEmail,
          fullName: data.fullName ?? null,
          phone: data.phone ?? null,
          role: data.role as RacPortalRole,
        });
      } catch (err) {
        const msg = err instanceof Error ? err.message : '';
        if (msg.includes('23505') || msg.toLowerCase().includes('unique')) {
          return NextResponse.json(
            {
              error:
                'A portal user with this email already exists for another customer in this tenant',
            },
            { status: 409 },
          );
        }
        throw err;
      }
    }

    const inv = await createRacInvitation({
      tenantId,
      portalUserId: user.id,
      invitedByUserId: req.headers.get('x-user-id') ?? 'staff',
    });

    const invitation = await dispatchAndBuildInvitationResponse({
      req,
      inv,
      recipientEmail: user.email,
      recipientName: user.fullName,
      companyName: customer.companyName ?? customer.fullName,
      role: user.role,
    });

    void logAudit({
      tenantId,
      userId: req.headers.get('x-user-id') ?? undefined,
      userRole: req.headers.get('x-user-role') ?? undefined,
      entityType: 'RacPortalUser',
      entityId: user.id,
      entityName: user.email,
      action: 'CREATE',
      details: `Issued B2B RAC portal invite to ${user.email} (${user.role}) for customer ${customer.companyName ?? customer.fullName} (emailDispatched=${invitation.emailDispatched}).`,
    });

    return NextResponse.json(
      {
        user,
        invitation,
      },
      { status: 201 },
    );
  } catch (err) {
    console.error('POST /api/rental/customers/[id]/portal-users error:', err);
    return NextResponse.json({ error: 'Failed to create portal user' }, { status: 500 });
  }
}

/* ─── PATCH: Toggle active status and/or resend invite (`rental:approve:customers`) ─── */
export async function PATCH(req: NextRequest, props: { params: Promise<{ id: string }> }) {
  const params = await props.params;
  const authz = requireAuthorizedTenant(req);
  if (!authz.ok) {
    return NextResponse.json({ error: authz.error }, { status: authz.status });
  }
  const { tenantId } = authz;

  const denied = await requireRentalPermission(
    req.headers,
    tenantId,
    'approve',
    'customers',
    req.nextUrl.pathname,
  );
  if (denied) return denied;

  const jsonRaw = await req.json().catch(() => null);
  const json = stripTenantOwnershipFields(
    (jsonRaw && typeof jsonRaw === 'object' ? jsonRaw : {}) as Record<string, unknown>,
  );
  const parsed = patchBodySchema.safeParse(json);
  if (!parsed.success) {
    return NextResponse.json(
      {
        error: 'Validation failed',
        details: parsed.error.issues.map((i) => ({
          path: i.path.join('.'),
          message: i.message,
        })),
      },
      { status: 400 },
    );
  }
  const data = parsed.data;

  try {
    const customer = await verifyTenantCustomer(tenantId, params.id);
    if (!customer) {
      return NextResponse.json({ error: 'Customer not found' }, { status: 404 });
    }

    const existing = await getRacPortalUserById(tenantId, data.userId);
    if (!existing || existing.customerId !== params.id) {
      return NextResponse.json({ error: 'Portal user not found' }, { status: 404 });
    }

    if (typeof data.isActive === 'boolean') {
      await setRacPortalUserActive(tenantId, data.userId, data.isActive);
    }

    let invitation: Awaited<ReturnType<typeof dispatchAndBuildInvitationResponse>> | null = null;

    if (data.resendInvite) {
      if (String(customer.customerType ?? '').toUpperCase() !== 'CORPORATE') {
        return NextResponse.json(
          {
            error: 'B2B portal invitations can only be issued for CORPORATE customers',
            code: 'CORPORATE_CUSTOMER_REQUIRED',
          },
          { status: 422 },
        );
      }
      const inv = await createRacInvitation({
        tenantId,
        portalUserId: data.userId,
        invitedByUserId: req.headers.get('x-user-id') ?? 'staff',
      });
      invitation = await dispatchAndBuildInvitationResponse({
        req,
        inv,
        recipientEmail: existing.email,
        recipientName: existing.fullName,
        companyName: customer.companyName ?? customer.fullName,
        role: existing.role,
      });
    }

    const updatedUser = await getRacPortalUserById(tenantId, data.userId);
    return NextResponse.json({
      user: updatedUser,
      ...(invitation ? { invitation } : {}),
    });
  } catch (err) {
    console.error('PATCH /api/rental/customers/[id]/portal-users error:', err);
    return NextResponse.json({ error: 'Failed to update portal user' }, { status: 500 });
  }
}

/* ─── DELETE: Revoke / soft-delete portal user (`rental:approve:customers`) ─── */
export async function DELETE(req: NextRequest, props: { params: Promise<{ id: string }> }) {
  const params = await props.params;
  const authz = requireAuthorizedTenant(req);
  if (!authz.ok) {
    return NextResponse.json({ error: authz.error }, { status: authz.status });
  }
  const { tenantId } = authz;

  const denied = await requireRentalPermission(
    req.headers,
    tenantId,
    'approve',
    'customers',
    req.nextUrl.pathname,
  );
  if (denied) return denied;

  const queryUserId = req.nextUrl.searchParams.get('userId')?.trim() ?? '';
  const bodyRaw = await req.json().catch(() => ({}));
  const body = stripTenantOwnershipFields(
    (bodyRaw && typeof bodyRaw === 'object' ? bodyRaw : {}) as Record<string, unknown>,
  );
  const userId =
    queryUserId || (typeof body.userId === 'string' ? body.userId.trim() : '');

  if (!userId || !UUID_RE.test(userId)) {
    return NextResponse.json({ error: 'Valid UUID userId is required' }, { status: 400 });
  }

  try {
    const customer = await verifyTenantCustomer(tenantId, params.id);
    if (!customer) {
      return NextResponse.json({ error: 'Customer not found' }, { status: 404 });
    }

    const existing = await getRacPortalUserById(tenantId, userId);
    if (!existing || existing.customerId !== params.id) {
      return NextResponse.json({ error: 'Portal user not found' }, { status: 404 });
    }

    const deleted = await deleteRacPortalUser(tenantId, userId);
    return NextResponse.json({ ok: true, deleted });
  } catch (err) {
    console.error('DELETE /api/rental/customers/[id]/portal-users error:', err);
    return NextResponse.json({ error: 'Failed to delete portal user' }, { status: 500 });
  }
}
