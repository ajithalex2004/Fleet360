/**
 * POST /api/admin/impersonate/stop
 *
 * Restores the impersonator's original session from the
 * "xl-impersonator-session" cookie and clears the impersonation marker.
 * Anyone holding the impersonation cookie may call this — it only ever
 * restores back to the original (signed, verified) session.
 */

import { NextRequest, NextResponse } from 'next/server';
import { verifySession } from '@/lib/tenant-session';
import { logAudit } from '@/lib/audit';
import { captureException } from '@/lib/sentry';

export const runtime = 'nodejs';

const COOKIE_NAME              = 'xl-session';
const IMPERSONATOR_COOKIE_NAME = 'xl-impersonator-session';

export async function POST(req: NextRequest) {
  try {
    const stashed = req.cookies.get(IMPERSONATOR_COOKIE_NAME)?.value;
    if (!stashed) {
      return NextResponse.json({ ok: false, error: 'No impersonation session to revert' }, { status: 400 });
    }
    const original = await verifySession(stashed);
    if (!original) {
      // Stashed token expired — wipe both cookies and force re-login.
      const res = NextResponse.json({ ok: false, error: 'Original session expired — please sign in again.' }, { status: 401 });
      res.cookies.delete(COOKIE_NAME);
      res.cookies.delete(IMPERSONATOR_COOKIE_NAME);
      return res;
    }

    const impersonatedBy = req.headers.get('x-impersonated-by') ?? '';
    const tenantId       = req.headers.get('x-tenant-id') ?? '';
    void logAudit({
      tenantId: tenantId || undefined,
      userId: impersonatedBy || original.userId,
      userRole: 'SUPER_ADMIN',
      entityType: 'Impersonation',
      action: 'DELETE',
      details: `Impersonation ended; restored to user ${original.userId}.`,
    });

    const res = NextResponse.json({ ok: true });
    // Restore: copy stashed token back to the primary session cookie.
    res.cookies.set(COOKIE_NAME, stashed, {
      httpOnly: true, sameSite: 'lax',
      secure: process.env.NODE_ENV === 'production',
      maxAge: 24 * 60 * 60, path: '/',
    });
    res.cookies.delete(IMPERSONATOR_COOKIE_NAME);
    return res;
  } catch (err) {
    captureException(err, { context: 'admin.impersonate.stop' });
    return NextResponse.json({ ok: false, error: 'Could not stop impersonation' }, { status: 500 });
  }
}
