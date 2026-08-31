export const dynamic = 'force-dynamic';

/**
 * src/app/api/driver-app/auth/biometric/status/route.ts
 *
 * Boot-time status the launcher queries. Tells the client whether
 * this device has a registered credential, and whether there's a
 * live session. The launcher uses this to decide:
 *   - skip the launch screen and go straight to /today (if session)
 *   - show biometric prompt (if credential)
 *   - show password form (otherwise)
 *
 * Auth: the device may have either a live session (cookie) or just
 * a registered credential. We support both: with cookie, return
 * hasSession=true; with credential but no cookie, return
 * hasBiometricRegistered=true so the launcher can prompt the user.
 *
 * Note: this endpoint deliberately doesn't 401 when there's no
 * session — that would prevent the launcher from ever showing the
 * password form. Instead it returns the bits the launcher needs.
 */

import { NextRequest, NextResponse } from 'next/server';
import { withTenantRls } from '@/lib/rls';
import { prisma } from '@/lib/prisma';
import { getTenantContextOrNull } from '@/lib/tenant-session';

import { requireAuthorizedTenant, stripTenantOwnershipFields } from '@/lib/tenant-context';
export async function GET(req: NextRequest) {

  const authz = requireAuthorizedTenant({ headers: req.headers, nextUrl: req.nextUrl });
  if (!authz.ok) {
    return NextResponse.json({ error: authz.error }, { status: authz.status });
  }
  const { tenantId } = authz;

  return withTenantRls(prisma, tenantId, async (tx) => {
    // The cookie name for the driver app is separate from the admin's
      // so the two audiences are isolated. Both cookies use the same
      // session token format (we just sign the role into the payload).
      const driverSession = req.cookies.get('xl-driver-session')?.value;
      const adminSession = req.cookies.get('xl-session')?.value;
      // Use either cookie for the hasSession check. In a clean driver
      // install, only xl-driver-session is set; admin installs never
      // touch this endpoint so the admin cookie is irrelevant.
      const hasSession = Boolean(driverSession || adminSession);

      // The username hint comes from the existing session so the launcher
      // can pre-fill the WebAuthn ceremony without asking twice. If
      // there's no session, return null and let the launcher prompt.
      let usernameHint: string | undefined;
      const ctx = getTenantContextOrNull(req);
      if (ctx) {
        const u = await tx.user.findUnique({
          where: { id: ctx.userId },
          select: { email: true },
        });
        usernameHint = u?.email ?? undefined;
      }

      // We don't know which user owns the registered credentials on
      // THIS device (the device has only the credential id, not the
      // user id). To support multi-user device sign-in, we'd store
      // a device fingerprint in localStorage and look it up. For the
      // first cut, the launcher asks for a username hint and the user
      // types their email — the API confirms ownership.
      //
      // Returning hasBiometricRegistered = "this server has any
      // credentials" is wrong; we want it to mean "this device has
      // credentials for the user identified by usernameHint". For the
      // first cut, if the user has a session, we look up their
      // credentials. If not, we just return false and the launcher
      // will go to the password path.
      let hasBiometricRegistered = false;
      if (ctx) {
        const creds = await tx.$queryRaw<Array<{ id: string }>>`
          SELECT id FROM webauthn_credentials
          WHERE user_id = ${ctx.userId}::uuid
          LIMIT 1
        `;
        hasBiometricRegistered = creds.length > 0;
      }

      return NextResponse.json({
        hasSession,
        hasBiometricRegistered,
        usernameHint,
      });
  });
}

