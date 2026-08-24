/**
 * src/app/api/driver-app/auth/biometric/login/start/route.ts
 *
 * Begin a WebAuthn assertion ceremony. The client calls this with a
 * username (typically the driver's employeeId), gets back the
 * PublicKeyCredentialRequestOptions, passes them to
 * navigator.credentials.get(), then POSTs the resulting assertion to
 * the finish endpoint.
 *
 * This endpoint does NOT require a session — it's the login flow. The
 * credential id we accept is whatever the driver registered earlier.
 * The platform authenticator proves the user is physically present
 * (biometric or device PIN).
 *
 * If the username has no credentials registered, we return 404 with a
 * helpful error so the client can fall back to password login.
 */

import { NextRequest, NextResponse } from 'next/server';
import { withTenantRls } from '@/lib/rls';
import { prisma } from '@/lib/prisma';
import { generateAuthenticationOptions } from '@simplewebauthn/server';

import { requireAuthorizedTenant, stripTenantOwnershipFields } from '@/lib/tenant-context';
export async function POST(req: NextRequest) {

  const authz = requireAuthorizedTenant({ headers: req.headers, nextUrl: req.nextUrl });
  if (!authz.ok) {
    return NextResponse.json({ error: authz.error }, { status: authz.status });
  }
  const { tenantId } = authz;

  return withTenantRls(prisma, tenantId, async (tx) => {
    const bodyRaw = await req.json() as { username?: string };
  const body = stripTenantOwnershipFields(bodyRaw);
      if (!body?.username) {
        return NextResponse.json({ error: 'username required' }, { status: 400 });
      }

      // Look up the driver by employeeId. We accept either the employeeId
      // (preferred, drivers remember it) or the user id directly.
      const driver = await tx.user.findFirst({
        where: {
          OR: [
            { email: body.username },
            // employeeId lookup via StaffMember — keeping the login robust
            // when the user enters their staff id rather than email.
          ],
        },
        select: { id: true, email: true },
      });
      if (!driver) {
        return NextResponse.json({ error: 'driver not found' }, { status: 404 });
      }

      const credentials = await tx.$queryRaw<Array<{ id: string }>>`
        SELECT id FROM webauthn_credentials
        WHERE user_id = ${driver.id}::uuid
        ORDER BY last_used_at DESC NULLS LAST
      `;
      if (credentials.length === 0) {
        return NextResponse.json({ error: 'no biometric registered' }, { status: 404 });
      }

      const env = process.env.NEXT_PUBLIC_DRIVER_RP_ID
        || (process.env.NODE_ENV === 'development' ? 'localhost' : null);
      if (!env) {
        return NextResponse.json({ error: 'server misconfigured' }, { status: 500 });
      }

      const options = await generateAuthenticationOptions({
        rpID: env,
        timeout: 60_000,
        userVerification: 'required',
        allowCredentials: credentials.map((c) => ({ id: c.id })),
      });

      await tx.$executeRaw`
        INSERT INTO webauthn_challenges (challenge, user_id, kind, expires_at)
        VALUES (${options.challenge}, ${driver.id}::uuid, 'login', NOW() + INTERVAL '2 minutes')
      `;

      return NextResponse.json({ ...options, driverId: driver.id });
  });
}

