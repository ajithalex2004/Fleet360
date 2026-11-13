export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { prisma } from '@/lib/prisma';
import { sendEmail } from '@/lib/email';
import { withTenantRls } from '@/lib/rls';
import { runOutsideRlsScope } from '@/lib/rls-scope';
import { stripTenantOwnershipFields } from '@/lib/tenant-context';
import {
  createRacPortalUser,
  deleteRacPortalUser,
  getRacPortalUserById,
  listRacPortalUsersByCustomer,
  setRacPortalUserActive,
} from '@/lib/rac-portal/portal-users-store';
import { createRacInvitation } from '@/lib/rac-portal/invitations';
import {
  ADMIN_RAC_PORTAL_ROLES,
  ALL_RAC_PORTAL_ROLES,
  requireRacPortalRole,
} from '../_helpers';

const UUID_REGEX = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const InviteMemberSchema = z.object({
  email: z.string().trim().max(254).email('Please provide a valid corporate email address'),
  fullName: z.string().trim().min(2, 'Full name is required').max(120),
  phone: z.string().trim().max(40).optional(),
  role: z
    .enum([
      'RAC_B2B_VIEWER',
      'RAC_B2B_BOOKER',
      'RAC_B2B_FINANCE',
      'RAC_B2B_ADMIN',
      'RAC_B2B_USER',
    ])
    .default('RAC_B2B_BOOKER'),
});

const PatchMemberSchema = z.object({
  userId: z.string().uuid('Invalid userId format'),
  isActive: z.boolean().optional(),
  resendInvite: z.boolean().optional(),
});

function resolveAppOrigin(req: NextRequest): string {
  const configured = (process.env.NEXT_PUBLIC_APP_URL || process.env.APP_URL || '').trim();
  const base = configured || req.nextUrl.origin;
  return base.replace(/\/$/, '');
}

async function dispatchB2bOnboardingEmail(args: {
  req: NextRequest;
  recipientEmail: string;
  recipientName: string | null;
  role: string;
  rawToken: string;
  expiresAt: string;
}): Promise<{ emailDispatched: boolean; setupPath: string }> {
  const setupPath = `/rac-portal/setup?token=${encodeURIComponent(args.rawToken)}`;
  const fullSetupUrl = `${resolveAppOrigin(args.req)}${setupPath}`;
  const greetingName = args.recipientName?.trim() || args.recipientEmail;

  try {
    const emailRes = await runOutsideRlsScope(() =>
      sendEmail({
        to: args.recipientEmail,
        subject: 'Fleet360 Corporate B2B Mobility Portal — Activate Your Account',
        text: [
          `Hello ${greetingName},`,
          '',
          `You have been invited to join the Fleet360 Corporate B2B Mobility Portal (${args.role}).`,
          `Activate your account and set your password using this single-use link (valid until ${new Date(args.expiresAt).toUTCString()}):`,
          fullSetupUrl,
          '',
          'If you were not expecting this invitation, you can safely ignore this email.',
        ].join('\n'),
        html: `<div style="font-family:Arial,sans-serif;max-width:560px;line-height:1.5;color:#0f172a">
          <h2 style="margin:0 0 12px">Corporate B2B Mobility Portal Invitation</h2>
          <p>Hello <strong>${greetingName.replace(/[<>&"]/g, '')}</strong>,</p>
          <p>You have been invited to access the Fleet360 Corporate B2B Mobility Portal with role <strong>${args.role}</strong>.</p>
          <p style="margin:20px 0">
            <a href="${fullSetupUrl}" style="display:inline-block;padding:12px 20px;background:#0891b2;color:#ffffff;text-decoration:none;border-radius:8px;font-weight:bold">
              Activate Corporate Portal Account
            </a>
          </p>
          <p style="font-size:12px;color:#475569">This single-use link expires in 7 days (${new Date(args.expiresAt).toUTCString()}).</p>
        </div>`,
      }),
    );
    return { emailDispatched: Boolean(emailRes.sent), setupPath };
  } catch (err) {
    console.warn('[rac-portal/team] Invitation email dispatch skipped:', err);
    return { emailDispatched: false, setupPath };
  }
}

export async function GET(req: NextRequest) {
  const ctx = await requireRacPortalRole(req, ALL_RAC_PORTAL_ROLES);
  if (ctx instanceof NextResponse) return ctx;

  try {
    const users = await listRacPortalUsersByCustomer(ctx.tenantId, ctx.customerId);
    return NextResponse.json({
      users,
      canManage: ctx.user.role === 'RAC_B2B_ADMIN',
    });
  } catch (err) {
    console.error('[rac-portal/team] GET failed:', err);
    return NextResponse.json(
      { error: 'Failed to load corporate team members' },
      { status: 500 },
    );
  }
}

export async function POST(req: NextRequest) {
  const ctx = await requireRacPortalRole(
    req,
    ADMIN_RAC_PORTAL_ROLES,
    'Corporate B2B Admin (RAC_B2B_ADMIN) role is required to invite team members.',
  );
  if (ctx instanceof NextResponse) return ctx;

  try {
    const rawBody = await req.json().catch(() => null);
    const sanitizedPost =
      rawBody && typeof rawBody === 'object'
        ? stripTenantOwnershipFields(rawBody as Record<string, unknown>)
        : rawBody;
    const parsed = InviteMemberSchema.safeParse(sanitizedPost);
    if (!parsed.success) {
      return NextResponse.json(
        { error: parsed.error.issues[0]?.message ?? 'Invalid invitation details' },
        { status: 400 },
      );
    }

    const { email, fullName, phone, role } = parsed.data;

    // Check for duplicate active/pending user on this tenant without leaking cross-customer membership
    const existing = await withTenantRls(prisma, ctx.tenantId, (tx) =>
      tx.$queryRawUnsafe<Array<{ id: string; customer_id: string }>>(
        `SELECT id::text AS id, customer_id
           FROM rac_portal_users
          WHERE tenant_id = $1 AND lower(email) = lower($2) AND deleted_at IS NULL
          LIMIT 1`,
        ctx.tenantId,
        email,
      ),
    );
    if (existing[0]) {
      if (existing[0].customer_id !== ctx.customerId) {
        return NextResponse.json(
          {
            error:
              'Unable to invite this email address. Please contact your RAC account manager.',
          },
          { status: 400 },
        );
      }
      return NextResponse.json(
        { error: 'A team member with this email address already exists on your corporate account.' },
        { status: 409 },
      );
    }

    const user = await createRacPortalUser({
      tenantId: ctx.tenantId,
      customerId: ctx.customerId,
      email,
      fullName,
      phone: phone ?? null,
      role,
    });

    let inv;
    try {
      inv = await createRacInvitation({
        tenantId: ctx.tenantId,
        portalUserId: user.id,
        invitedByUserId: ctx.userId,
      });
    } catch (invErr) {
      // Atomic compensation: remove newly created uninvited user so no orphan row remains
      await withTenantRls(prisma, ctx.tenantId, (tx) =>
        tx.$executeRawUnsafe(
          `DELETE FROM rac_portal_users WHERE id = $1::uuid AND tenant_id = $2`,
          user.id,
          ctx.tenantId,
        ),
      ).catch(async () => {
        await deleteRacPortalUser(ctx.tenantId, user.id).catch(() => {});
      });
      throw invErr;
    }

    const { emailDispatched, setupPath } = await dispatchB2bOnboardingEmail({
      req,
      recipientEmail: user.email,
      recipientName: user.fullName,
      role: user.role,
      rawToken: inv.rawToken,
      expiresAt: inv.expiresAt,
    });

    return NextResponse.json(
      {
        ok: true,
        user,
        invitation: {
          id: inv.id,
          invited: true,
          emailDispatched,
          setupUrl: setupPath,
          expiresAt: inv.expiresAt,
        },
      },
      { status: 201 },
    );
  } catch (err) {
    console.error('[rac-portal/team] POST failed:', err);
    return NextResponse.json(
      { error: 'Failed to invite team member' },
      { status: 500 },
    );
  }
}

export async function PATCH(req: NextRequest) {
  const ctx = await requireRacPortalRole(
    req,
    ADMIN_RAC_PORTAL_ROLES,
    'Corporate B2B Admin (RAC_B2B_ADMIN) role is required to update team members.',
  );
  if (ctx instanceof NextResponse) return ctx;

  try {
    const rawBody = await req.json().catch(() => null);
    const sanitizedPatch =
      rawBody && typeof rawBody === 'object'
        ? stripTenantOwnershipFields(rawBody as Record<string, unknown>)
        : rawBody;
    const parsed = PatchMemberSchema.safeParse(sanitizedPatch);
    if (!parsed.success) {
      return NextResponse.json(
        { error: parsed.error.issues[0]?.message ?? 'Invalid update payload' },
        { status: 400 },
      );
    }

    const { userId, isActive, resendInvite } = parsed.data;
    if (typeof isActive !== 'boolean' && !resendInvite) {
      return NextResponse.json(
        { error: 'Provide isActive or resendInvite to update team member' },
        { status: 400 },
      );
    }

    if (userId === ctx.userId && isActive === false) {
      return NextResponse.json(
        { error: 'You cannot deactivate your own administrator account.' },
        { status: 400 },
      );
    }

    const belongsToCustomer = await withTenantRls(prisma, ctx.tenantId, async (tx) => {
      const rows = await tx.$queryRawUnsafe<Array<{ id: string }>>(
        `SELECT id::text AS id
           FROM rac_portal_users
          WHERE id = $1::uuid AND tenant_id = $2 AND customer_id = $3 AND deleted_at IS NULL
          LIMIT 1`,
        userId,
        ctx.tenantId,
        ctx.customerId,
      );
      return Boolean(rows[0]);
    });

    if (!belongsToCustomer) {
      return NextResponse.json({ error: 'Team member not found' }, { status: 404 });
    }

    if (typeof isActive === 'boolean') {
      await setRacPortalUserActive(ctx.tenantId, userId, isActive);
    }

    let invitation:
      | {
          id: string;
          invited: true;
          emailDispatched: boolean;
          setupUrl: string;
          expiresAt: string;
        }
      | undefined;

    if (resendInvite) {
      const targetUser = await getRacPortalUserById(ctx.tenantId, userId);
      if (!targetUser || targetUser.customerId !== ctx.customerId) {
        return NextResponse.json({ error: 'Team member not found' }, { status: 404 });
      }
      const inv = await createRacInvitation({
        tenantId: ctx.tenantId,
        portalUserId: userId,
        invitedByUserId: ctx.userId,
      });
      const { emailDispatched, setupPath } = await dispatchB2bOnboardingEmail({
        req,
        recipientEmail: targetUser.email,
        recipientName: targetUser.fullName,
        role: targetUser.role,
        rawToken: inv.rawToken,
        expiresAt: inv.expiresAt,
      });
      invitation = {
        id: inv.id,
        invited: true,
        emailDispatched,
        setupUrl: setupPath,
        expiresAt: inv.expiresAt,
      };
    }

    return NextResponse.json({
      ok: true,
      ...(invitation ? { invitation } : {}),
    });
  } catch (err) {
    console.error('[rac-portal/team] PATCH failed:', err);
    return NextResponse.json({ error: 'Failed to update team member' }, { status: 500 });
  }
}

export async function DELETE(req: NextRequest) {
  const ctx = await requireRacPortalRole(
    req,
    ADMIN_RAC_PORTAL_ROLES,
    'Corporate B2B Admin (RAC_B2B_ADMIN) role is required to remove team members.',
  );
  if (ctx instanceof NextResponse) return ctx;

  try {
    const userId = req.nextUrl.searchParams.get('userId')?.trim() ?? '';
    if (!userId) {
      return NextResponse.json({ error: 'userId is required' }, { status: 400 });
    }
    if (!UUID_REGEX.test(userId)) {
      return NextResponse.json({ error: 'Invalid userId format' }, { status: 400 });
    }
    if (userId === ctx.userId) {
      return NextResponse.json(
        { error: 'You cannot remove your own administrator account.' },
        { status: 400 },
      );
    }

    const belongsToCustomer = await withTenantRls(prisma, ctx.tenantId, async (tx) => {
      const rows = await tx.$queryRawUnsafe<Array<{ id: string }>>(
        `SELECT id::text AS id
           FROM rac_portal_users
          WHERE id = $1::uuid AND tenant_id = $2 AND customer_id = $3 AND deleted_at IS NULL
          LIMIT 1`,
        userId,
        ctx.tenantId,
        ctx.customerId,
      );
      return Boolean(rows[0]);
    });

    if (!belongsToCustomer) {
      return NextResponse.json({ error: 'Team member not found' }, { status: 404 });
    }

    await deleteRacPortalUser(ctx.tenantId, userId);
    return NextResponse.json({ ok: true });
  } catch (err) {
    console.error('[rac-portal/team] DELETE failed:', err);
    return NextResponse.json({ error: 'Failed to remove team member' }, { status: 500 });
  }
}
