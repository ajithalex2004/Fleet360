/**
 * POST /api/leasing-portal/auth/login
 *
 * Body: { email, password }
 * On success: HttpOnly leasing-portal-session cookie + { ok, user } body.
 *
 * This is a public route (see PUBLIC_PREFIXES in auth-route-policies.ts) —
 * it must NOT call requireAuthorizedTenant, since a lessee has no staff
 * session. Tenant is resolved from the portal user's own row.
 *
 * Generic error message on the bad-credentials path so we don't leak
 * which of {email exists, password matches, account is active} failed.
 */

import { NextRequest, NextResponse } from 'next/server';
import { _findUserWithHashByEmail, markPortalUserLoggedIn } from '@/lib/leasing-portal/portal-users-store';
import { signPortalSession, buildSessionCookie } from '@/lib/leasing-portal/auth';
import { verifyPassword } from '@/lib/password-policy';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const GENERIC_AUTH_ERROR = 'Invalid email or password';

export async function POST(req: NextRequest) {
  try {
    const body = await req.json().catch(() => ({})) as { email?: string; password?: string };
    const email = String(body.email ?? '').trim().toLowerCase();
    const password = String(body.password ?? '');
    if (!email || !password) {
      return NextResponse.json({ error: GENERIC_AUTH_ERROR }, { status: 401 });
    }

    const user = await _findUserWithHashByEmail(email);
    if (!user || !user.passwordHash || !user.isActive) {
      return NextResponse.json({ error: GENERIC_AUTH_ERROR }, { status: 401 });
    }
    if (!verifyPassword(password, user.passwordHash)) {
      return NextResponse.json({ error: GENERIC_AUTH_ERROR }, { status: 401 });
    }

    await markPortalUserLoggedIn(user.id);

    const { token } = signPortalSession({
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
    res.headers.set('Set-Cookie', buildSessionCookie(token));
    return res;
  } catch (e) {
    console.error('[leasing-portal/auth/login]', e);
    return NextResponse.json({ error: 'Login failed' }, { status: 500 });
  }
}
