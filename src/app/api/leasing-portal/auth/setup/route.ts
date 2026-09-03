/**
 * POST /api/leasing-portal/auth/setup
 *
 * Token-based first-time setup. Called from the invitation link landing
 * page after the lessee picks a password.
 *
 *   Body: { token: string, password: string }
 *   Response (200): sets HttpOnly leasing-portal-session cookie, returns
 *                   { ok: true, user }
 *   Errors:
 *     400 — missing/weak password
 *     401 — invalid / expired / already-used token
 *
 * Public route — no staff session exists at this point. Single-use
 * enforcement is in acceptInvitation() (atomic UPDATE).
 */

import { NextRequest, NextResponse } from 'next/server';
import { acceptInvitation } from '@/lib/leasing-portal/invitations';
import { getPortalUserById, markPortalUserLoggedIn } from '@/lib/leasing-portal/portal-users-store';
import { signPortalSession, buildSessionCookie } from '@/lib/leasing-portal/auth';
import { hashPassword, validatePassword } from '@/lib/password-policy';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

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
      lesseeId: user.lesseeId,
      tenantId: user.tenantId,
    });

    const res = NextResponse.json({
      ok: true,
      user: {
        id: user.id,
        email: user.email,
        fullName: user.fullName,
        role: user.role,
        lesseeId: user.lesseeId,
      },
    });
    res.headers.set('Set-Cookie', buildSessionCookie(sessionToken));
    return res;
  } catch (e) {
    console.error('[leasing-portal/auth/setup]', e);
    return NextResponse.json({ error: 'Setup failed' }, { status: 500 });
  }
}
