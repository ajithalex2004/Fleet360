export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * Customer Portal password setup from an invite link.
 *
 * GET  /api/customer-portal/auth/setup?token=…   → { email, fullName, customerName } for a valid invite
 * POST /api/customer-portal/auth/setup           Body: { token, password }
 *   Sets the password (password policy enforced), consumes the single-use
 *   token, ends any open sessions and signs the user in.
 */

import { NextRequest, NextResponse } from 'next/server';
import { hashPassword, validatePasswordPolicy } from '@/lib/password-policy';
import { acceptPortalInvitation, resolvePortalInvitation } from '@/lib/customer-portal/users';
import { buildCustomerPortalCookie, signCustomerPortalSession } from '@/lib/customer-portal/session';
import { limitCustomerPortalAuth } from '@/lib/customer-portal/rate-limit';

const INVALID = 'This invite link is invalid or has expired. Ask your service provider for a new one.';

export async function GET(req: NextRequest) {
  const limited = await limitCustomerPortalAuth(req, 'setup');
  if (limited) return limited;
  const token = req.nextUrl.searchParams.get('token') ?? '';
  const invite = await resolvePortalInvitation(token).catch(() => null);
  if (!invite) return NextResponse.json({ ok: false, error: INVALID }, { status: 404 });
  return NextResponse.json({ ok: true, ...invite });
}

export async function POST(req: NextRequest) {
  const limited = await limitCustomerPortalAuth(req, 'setup');
  if (limited) return limited;
  const body = (await req.json().catch(() => null)) as { token?: unknown; password?: unknown } | null;
  const token = typeof body?.token === 'string' ? body.token : '';
  const password = typeof body?.password === 'string' ? body.password : '';
  const policy = validatePasswordPolicy(password);
  if (!policy.ok) return NextResponse.json({ ok: false, error: policy.error ?? 'Choose a stronger password' }, { status: 400 });

  try {
    const user = await acceptPortalInvitation(token, hashPassword(password));
    if (!user) return NextResponse.json({ ok: false, error: INVALID }, { status: 404 });
    const res = NextResponse.json({ ok: true });
    res.headers.set('Set-Cookie', buildCustomerPortalCookie(
      signCustomerPortalSession({ userId: user.id, customerId: user.customerId, tenantId: user.tenantId, sv: user.sessionVersion }),
    ));
    return res;
  } catch (err) {
    console.error('[customer-portal/auth/setup] failed:', err);
    return NextResponse.json({ ok: false, error: 'Unable to set your password right now' }, { status: 500 });
  }
}
