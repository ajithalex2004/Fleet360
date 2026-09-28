export const dynamic = 'force-dynamic';

import { NextRequest, NextResponse } from 'next/server';
import { requireAuthorizedTenant } from '@/lib/tenant-context';
import { revokeSessions } from '@/lib/auth/session-revocation';

export const runtime = 'nodejs';

/**
 * POST /api/auth/logout-all
 *
 * Sign out everywhere: every session of the signed-in user, in every tenant
 * and on every device, ends within 60 s; this browser's cookie is cleared
 * now. Also invalidates the user's Go-backend tokens (same revocation).
 */
export async function POST(req: NextRequest) {
  const authz = requireAuthorizedTenant({ headers: req.headers });
  if (!authz.ok) return NextResponse.json({ error: authz.error }, { status: authz.status });
  if (!authz.userId) return NextResponse.json({ error: 'Authentication required' }, { status: 401 });

  await revokeSessions({ userId: authz.userId, reason: 'signed-out-everywhere', revokedBy: authz.userId });

  const res = NextResponse.json({ ok: true });
  for (const name of ['xl-session', 'xl-driver-session']) {
    res.cookies.set(name, '', { httpOnly: true, sameSite: 'lax', secure: process.env.NODE_ENV === 'production', path: '/', maxAge: 0 });
  }
  return res;
}
