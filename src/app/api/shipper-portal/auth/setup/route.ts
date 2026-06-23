/**
 * POST /api/shipper-portal/auth/setup
 *
 * Token-based first-time setup. Called from the invitation link landing
 * page after the user picks a password.
 *
 *   Body: { token: string, password: string }
 *   Response (200): sets HttpOnly shipper-portal-session cookie, returns
 *                   { ok: true, user }
 *   Errors:
 *     400 — missing/short password
 *     401 — invalid / expired / already-used token
 *
 * Single-use enforcement is in acceptInvitation() (atomic UPDATE).
 */

import { NextRequest, NextResponse } from 'next/server';
import { acceptInvitation } from '@/lib/shipper-portal/invitations';
import { getPortalUserById, markPortalUserLoggedIn } from '@/lib/shipper-portal/portal-users-store';
import { signPortalSession, buildSessionCookie } from '@/lib/shipper-portal/auth';
import { hashPassword, validatePassword } from '@/lib/password-policy';

export const runtime = 'nodejs';

export async function POST(req: NextRequest) {
  try {
    const body = await req.json().catch(() => ({})) as { token?: string; password?: string; email?: string };
    const token = String(body.token ?? '').trim();
    const password = String(body.password ?? '');
    if (!token) {
      return NextResponse.json({ error: 'Token is required' }, { status: 400 });
    }
    const validation = validatePassword(password, { email: body.email });
    if (!validation.ok) {
      return NextResponse.json({ error: validation.errors.join(' ') }, { status: 400 });
    }

    const passwordHash = hashPassword(password);
    const claimed = await acceptInvitation(token, passwordHash);
    if (!claimed) {
      return NextResponse.json(
        { error: 'This invitation link is invalid, expired, or has already been used.' },
        { status: 401 },
      );
    }

    const user = await getPortalUserById(claimed.tenantId, claimed.portalUserId);
    if (!user) {
      return NextResponse.json({ error: 'User not found after setup' }, { status: 500 });
    }
    await markPortalUserLoggedIn(user.id);

    const { token: sessionToken } = signPortalSession({
      userId: user.id,
      customerId: user.customerId,
      tenantId: user.tenantId,
    });

    const res = NextResponse.json({
      ok: true,
      user: {
        id: user.id,
        email: user.email,
        fullName: user.fullName,
        role: user.role,
        customerId: user.customerId,
      },
    });
    res.headers.set('Set-Cookie', buildSessionCookie(sessionToken));
    return res;
  } catch (e) {
    console.error('[shipper-portal/auth/setup]', e);
    return NextResponse.json({ error: 'Setup failed' }, { status: 500 });
  }
}
