export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * POST /api/customer-portal/auth/login   Body: { email, password }
 *
 * Customer Portal sign-in (separate from staff sign-in). Issues the
 * customer-portal-session cookie. Constant-time against unknown emails,
 * one generic error, rate-limited per IP and per (IP, email).
 */

import { NextRequest, NextResponse } from 'next/server';
import { hashPassword, verifyPassword, MAX_PASSWORD_LENGTH } from '@/lib/password-policy';
import { findActivePortalUsersByEmail, markPortalUserLoggedIn, portalsForCustomer } from '@/lib/customer-portal/users';
import { buildCustomerPortalCookie, openablePortals, signCustomerPortalSession } from '@/lib/customer-portal/session';
import { limitCustomerPortalAuth } from '@/lib/customer-portal/rate-limit';

const GENERIC = 'Invalid email or password';
const DUMMY_HASH = hashPassword('CustomerPortalConstantTimePad!2026');

export async function POST(req: NextRequest) {
  try {
    const body = (await req.json().catch(() => null)) as { email?: unknown; password?: unknown } | null;
    const email = typeof body?.email === 'string' ? body.email.trim().toLowerCase().slice(0, 254) : '';
    const password = typeof body?.password === 'string' ? body.password : '';

    const limited = await limitCustomerPortalAuth(req, 'login', email);
    if (limited) return limited;
    if (!email || !password) return NextResponse.json({ ok: false, error: 'Enter your email and password' }, { status: 400 });

    if (password.length > MAX_PASSWORD_LENGTH) {
      verifyPassword(password.slice(0, MAX_PASSWORD_LENGTH), DUMMY_HASH);
      return NextResponse.json({ ok: false, error: GENERIC }, { status: 401 });
    }
    const candidates = await findActivePortalUsersByEmail(email);
    if (candidates.length === 0) {
      verifyPassword(password, DUMMY_HASH);
      return NextResponse.json({ ok: false, error: GENERIC }, { status: 401 });
    }
    const matched = candidates.filter((c) => verifyPassword(password, c.passwordHash));
    if (matched.length === 0) return NextResponse.json({ ok: false, error: GENERIC }, { status: 401 });
    if (matched.length > 1) {
      return NextResponse.json({ ok: false, error: 'This email has more than one portal account. Contact your service provider.' }, { status: 409 });
    }

    const user = matched[0];
    const portals = openablePortals(user.roles, await portalsForCustomer(user.tenantId, user.customerId));
    if (portals.length === 0) {
      return NextResponse.json({ ok: false, error: 'No portal is enabled for your company yet' }, { status: 403 });
    }
    await markPortalUserLoggedIn(user.tenantId, user.id);
    const token = signCustomerPortalSession({
      userId: user.id, customerId: user.customerId, tenantId: user.tenantId, sv: user.sessionVersion,
    });
    const res = NextResponse.json({ ok: true, portals });
    res.headers.set('Set-Cookie', buildCustomerPortalCookie(token));
    return res;
  } catch (err) {
    console.error('[customer-portal/auth/login] failed:', err);
    return NextResponse.json({ ok: false, error: 'Unable to sign in right now' }, { status: 500 });
  }
}
