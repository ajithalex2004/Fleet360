export const dynamic = 'force-dynamic';

/**
 * src/app/api/driver-app/auth/biometric/login/finish/route.ts
 *
 * Verify a WebAuthn assertion and mint a session cookie for the driver.
 *
 * On success, the response sets `xl-driver-session` (a separate cookie
 * from the admin's `xl-session`) so the admin app and the driver app
 * can have different TTLs and different session policies. The driver
 * cookie has a longer TTL (24 h instead of 8 h) and skips the platform-
 * admin permission set.
 */

import { NextRequest, NextResponse } from 'next/server';
import { withTenantRls } from '@/lib/rls';
import { prisma } from '@/lib/prisma';
import { verifyAuthenticationResponse } from '@simplewebauthn/server';
import { signSession } from '@/lib/tenant-session';
import { newId } from '@/lib/driver-offline/db';

import { requireAuthorizedTenant, stripTenantOwnershipFields } from '@/lib/tenant-context';
export async function POST(req: NextRequest) {

  const authz = requireAuthorizedTenant({ headers: req.headers, nextUrl: req.nextUrl });
  if (!authz.ok) {
    return NextResponse.json({ error: authz.error }, { status: authz.status });
  }
  const { tenantId } = authz;

  return withTenantRls(prisma, tenantId, async (tx) => {
    const bodyRaw = await req.json() as { response: any; driverId?: string };
        const body = stripTenantOwnershipFields(bodyRaw);
      if (!body?.response || !body?.driverId) {
        return NextResponse.json({ error: 'response + driverId required' }, { status: 400 });
      }

      const challenges = await tx.$queryRaw<Array<{ challenge: string; user_id: string }>>`
        SELECT challenge, user_id FROM webauthn_challenges
        WHERE user_id = ${body.driverId}::uuid AND kind = 'login'
        ORDER BY created_at DESC LIMIT 1
      `;
      const expectedChallengeRow = challenges[0];
      if (!expectedChallengeRow) {
        return NextResponse.json({ error: 'no challenge in flight' }, { status: 400 });
      }

      const env = process.env.NEXT_PUBLIC_DRIVER_RP_ID
        || (process.env.NODE_ENV === 'development' ? 'localhost' : null);
      if (!env) {
        return NextResponse.json({ error: 'server misconfigured' }, { status: 500 });
      }

      // Look up the credential row.
      const credRow = await tx.$queryRaw<Array<{
        id: string; user_id: string; tenant_id: string; public_key: string; counter: number;
      }>>`
        SELECT id, user_id, tenant_id, public_key, counter FROM webauthn_credentials
        WHERE id = ${body.response.id} AND user_id = ${body.driverId}::uuid
        LIMIT 1
      `;
      if (credRow.length === 0) {
        return NextResponse.json({ error: 'unknown credential' }, { status: 400 });
      }
      const cred = credRow[0];

      let verification;
      try {
        verification = await verifyAuthenticationResponse({
          response: body.response,
          expectedChallenge: expectedChallengeRow.challenge,
          expectedOrigin: process.env.NEXT_PUBLIC_DRIVER_ORIGIN || `http://localhost:3000`,
          expectedRPID: env,
          // v10 of @simplewebauthn/server expects an `AuthenticatorDevice`
          // shape: { credentialID, credentialPublicKey, counter, transports? }.
          // The DB column `public_key` is stored base64-encoded; we decode
          // it back to a Buffer here.
          // (v10 also renamed the field from `credential` to `authenticator`.)
          authenticator: {
            credentialID: cred.id,
            credentialPublicKey: Buffer.from(cred.public_key, 'base64'),
            counter: cred.counter,
          },
          requireUserVerification: true,
        });
        } catch (e) {
        return NextResponse.json(
          { error: `verification failed: ${e instanceof Error ? e.message : String(e)}` },
          { status: 400 },
        );
      }

      if (!verification.verified) {
        return NextResponse.json({ error: 'verification failed' }, { status: 400 });
      }

      // Bump the counter — anti-replay.
      await tx.$executeRaw`
        UPDATE webauthn_credentials
        SET counter = ${verification.authenticationInfo.newCounter}, last_used_at = NOW()
        WHERE id = ${cred.id}
      `;

      // Single-use challenge.
      await tx.$executeRaw`
        DELETE FROM webauthn_challenges
        WHERE user_id = ${body.driverId}::uuid AND kind = 'login'
      `;

      // Mint a session. We pass a high role so the driver can access the
      // driver app's API surface without hitting the platform-admin perm
      // check. The session cookie name is different from the admin's to
      // keep the two audiences isolated.
      const sessionToken = await signSession({
        userId: body.driverId,
        tenantId: cred.tenant_id,
        plan: 'DRIVER',
        role: 'DRIVER',
        ttlMs: 24 * 60 * 60 * 1000,
      });

      const res = NextResponse.json({
        ok: true,
        userId: body.driverId,
        tenantId: cred.tenant_id,
        // Convenience: also return the next-trip summary so the client can
        // skip a round trip on login.
      });
      res.cookies.set('xl-driver-session', sessionToken, {
        httpOnly: true,
        sameSite: 'lax',
        secure: process.env.NODE_ENV === 'production',
        path: '/',
        maxAge: 24 * 60 * 60,
      });
      return res;
  });
}

