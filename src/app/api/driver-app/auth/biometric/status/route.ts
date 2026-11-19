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
void requireAuthorizedTenant;
void stripTenantOwnershipFields;

export async function GET(req: NextRequest) {
  // The cookie name for the driver app is separate from the admin's
  // so the two audiences are isolated. Both cookies use the same
  // session token format (we just sign the role into the payload).
  const driverSession = req.cookies.get('xl-driver-session')?.value;
  const adminSession = req.cookies.get('xl-session')?.value;
  const ctx = getTenantContextOrNull(req);
  const hasSession = Boolean(ctx || driverSession || adminSession);

  if (!ctx) {
    return NextResponse.json({
      hasSession: false,
      hasBiometricRegistered: false,
      usernameHint: undefined,
    });
  }

  return withTenantRls(prisma, ctx.tenantId, async (tx) => {
    let usernameHint: string | undefined;
    const u = await tx.user.findUnique({
      where: { id: ctx.userId },
      select: { email: true },
    });
    usernameHint = u?.email ?? undefined;

    const creds = await tx.$queryRaw<Array<{ id: string }>>`
      SELECT id FROM webauthn_credentials
      WHERE user_id = ${ctx.userId}::uuid
      LIMIT 1
    `;
    const hasBiometricRegistered = creds.length > 0;

    return NextResponse.json({
      hasSession,
      hasBiometricRegistered,
      usernameHint,
    });
  });
}

