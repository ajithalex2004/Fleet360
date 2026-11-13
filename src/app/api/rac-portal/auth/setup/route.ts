export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { prisma } from '@/lib/prisma';
import { withTenantRls } from '@/lib/rls';
import { signRacPortalSession, buildRacSessionCookie } from '@/lib/rac-portal/auth';
import { resolveRacInvitation, acceptRacInvitation } from '@/lib/rac-portal/invitations';
import {
  getRacPortalUserById,
  markRacPortalUserLoggedIn,
} from '@/lib/rac-portal/portal-users-store';
import {
  DEFAULT_PASSWORD_POLICY,
  hashPassword,
  MAX_PASSWORD_LENGTH,
  validatePassword,
} from '@/lib/password-policy';
import { enforceRacPortalSetupRateLimit } from '../../_helpers';

const SetupPostSchema = z.object({
  token: z.string().trim().min(10, 'Invalid setup token').max(256, 'Invalid setup token'),
  password: z
    .string()
    .min(1, 'Password is required')
    .max(MAX_PASSWORD_LENGTH, `Password must not exceed ${MAX_PASSWORD_LENGTH} characters`),
});

export async function GET(req: NextRequest) {
  const token = req.nextUrl.searchParams.get('token')?.trim() ?? '';
  const rl = await enforceRacPortalSetupRateLimit(req, 'preview', token);
  if (rl) return rl;

  try {
    if (!token || token.length > 256) {
      return NextResponse.json(
        { valid: false, error: 'Missing setup token in link' },
        { status: 401 },
      );
    }

    const inv = await resolveRacInvitation(token);
    if (!inv) {
      return NextResponse.json(
        { valid: false, error: 'Invitation link is invalid, expired, or has already been accepted.' },
        { status: 401 },
      );
    }

    const user = await getRacPortalUserById(inv.tenant_id, inv.portal_user_id);
    if (!user || !user.isActive) {
      return NextResponse.json(
        { valid: false, error: 'Invited corporate user account is no longer active.' },
        { status: 401 },
      );
    }

    const meta = await withTenantRls(prisma, inv.tenant_id, async (tx) => {
      const custRows = await tx.$queryRawUnsafe<
        Array<{ company_name: string | null; full_name: string }>
      >(
        `SELECT company_name, full_name
           FROM rental_customers
          WHERE id = $1 AND tenant_id::text = $2 AND deleted_at IS NULL
          LIMIT 1`,
        user.customerId,
        inv.tenant_id,
      );
      const tenant = await tx.tenant
        .findFirst({ where: { id: inv.tenant_id }, select: { name: true } })
        .catch(() => null);
      return {
        companyName: custRows[0]?.company_name ?? custRows[0]?.full_name ?? null,
        tenantName: tenant?.name ?? null,
      };
    }).catch(() => ({ companyName: null, tenantName: null }));

    return NextResponse.json({
      valid: true,
      email: user.email,
      fullName: user.fullName,
      role: user.role,
      expiresAt: inv.expires_at,
      companyName: meta.companyName,
      tenantName: meta.tenantName,
    });
  } catch (err) {
    console.error('[rac-portal/auth/setup] GET failed:', err);
    return NextResponse.json(
      { valid: false, error: 'Failed to validate invitation token' },
      { status: 500 },
    );
  }
}

export async function POST(req: NextRequest) {
  const rl = await enforceRacPortalSetupRateLimit(req, 'post');
  if (rl) return rl;

  try {
    const body = await req.json().catch(() => null);
    const parsed = SetupPostSchema.safeParse(body);
    if (!parsed.success) {
      return NextResponse.json(
        { error: parsed.error.issues[0]?.message ?? 'Token and password are required' },
        { status: 400 },
      );
    }

    const { token, password } = parsed.data;
    const tokenRl = await enforceRacPortalSetupRateLimit(req, 'post-token', token);
    if (tokenRl) return tokenRl;

    // Resolve invitation and target user BEFORE hashing so we enforce email-identifier checks
    // and reject deactivated/deleted accounts without burning tokens.
    const previewInv = await resolveRacInvitation(token);
    if (!previewInv) {
      return NextResponse.json(
        { error: 'Invitation link is invalid, expired, or has already been used.' },
        { status: 401 },
      );
    }

    const previewUser = await getRacPortalUserById(previewInv.tenant_id, previewInv.portal_user_id);
    if (!previewUser || !previewUser.isActive) {
      return NextResponse.json(
        { error: 'Invited corporate user account is no longer active.' },
        { status: 401 },
      );
    }

    const pwCheck = validatePassword(
      password,
      { email: previewUser.email },
      {
        ...DEFAULT_PASSWORD_POLICY,
        rejectCommon: true,
        rejectIdentifier: true,
      },
    );
    if (!pwCheck.ok) {
      return NextResponse.json(
        { error: pwCheck.errors.join('. '), errors: pwCheck.errors },
        { status: 400 },
      );
    }

    const hash = hashPassword(password);
    const claimed = await acceptRacInvitation(token, hash);
    if (!claimed) {
      return NextResponse.json(
        { error: 'Invitation link is invalid, expired, or has already been used.' },
        { status: 401 },
      );
    }

    await markRacPortalUserLoggedIn(claimed.tenantId, claimed.portalUserId);
    const user = await getRacPortalUserById(claimed.tenantId, claimed.portalUserId);
    if (!user || !user.isActive) {
      return NextResponse.json(
        { error: 'Account could not be activated. Contact your administrator.' },
        { status: 403 },
      );
    }

    const session = signRacPortalSession({
      userId: user.id,
      customerId: user.customerId,
      tenantId: user.tenantId,
      sv: user.sessionVersion,
    });

    const res = NextResponse.json({ ok: true, user });
    res.headers.set('Set-Cookie', buildRacSessionCookie(session.token));
    return res;
  } catch (err) {
    console.error('[rac-portal/auth/setup] POST failed:', err);
    return NextResponse.json(
      { error: 'Failed to complete account setup' },
      { status: 500 },
    );
  }
}
