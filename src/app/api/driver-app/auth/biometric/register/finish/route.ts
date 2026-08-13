/**
 * src/app/api/driver-app/auth/biometric/register/finish/route.ts
 *
 * Finish the WebAuthn registration ceremony. The client posts the
 * attestation response from navigator.credentials.create(); we verify
 * the signature against the challenge, persist the credential, and
 * mark the user as biometric-capable.
 *
 * The credential is stored with a server-generated `name` (defaults to
 * the device's User-Agent + a short ID) so the driver can manage
 * multiple devices from a "My devices" page later.
 */

import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { getTenantContextOrNull } from '@/lib/tenant-session';
import { verifyRegistrationResponse } from '@simplewebauthn/server';

export async function POST(req: NextRequest) {
  const ctx = getTenantContextOrNull(req);
  if (!ctx) {
    return NextResponse.json({ error: 'session required' }, { status: 401 });
  }

  const body = await req.json() as { response: any; name?: string };
  if (!body?.response) {
    return NextResponse.json({ error: 'response required' }, { status: 400 });
  }

  // Look up the challenge we issued.
  const challenges = await prisma.$queryRaw<Array<{ challenge: string }>>`
    SELECT challenge FROM webauthn_challenges
    WHERE user_id = ${ctx.userId}::uuid AND kind = 'register'
    ORDER BY created_at DESC LIMIT 1
  `;
  const expectedChallenge = challenges[0]?.challenge;
  if (!expectedChallenge) {
    return NextResponse.json({ error: 'no challenge in flight' }, { status: 400 });
  }

  const env = process.env.NEXT_PUBLIC_DRIVER_RP_ID
    || (process.env.NODE_ENV === 'development' ? 'localhost' : null);
  const origin = process.env.NEXT_PUBLIC_DRIVER_ORIGIN
    || (process.env.NODE_ENV === 'development' ? 'http://localhost:3000' : null);
  if (!env || !origin) {
    return NextResponse.json({ error: 'server misconfigured' }, { status: 500 });
  }

  let verification;
  try {
    verification = await verifyRegistrationResponse({
      response: body.response,
      expectedChallenge,
      expectedOrigin: origin,
      expectedRPID: env,
      requireUserVerification: true,
    });
  } catch (e) {
    return NextResponse.json(
      { error: `verification failed: ${e instanceof Error ? e.message : String(e)}` },
      { status: 400 },
    );
  }

  if (!verification.verified || !verification.registrationInfo) {
    return NextResponse.json({ error: 'verification failed' }, { status: 400 });
  }

  const regInfo = verification.registrationInfo;
  if (!regInfo) {
    return NextResponse.json({ error: 'no registration info returned' }, { status: 400 });
  }
  // v10 of @simplewebauthn/server flattens the credential fields onto
  // registrationInfo directly (no nested `.credential` object).
  const credentialId = regInfo.credentialID;
  const publicKey = Buffer.from(regInfo.credentialPublicKey).toString('base64');
  const counter = Number(regInfo.counter);
  const deviceName = body.name || `Device ${new Date().toISOString().slice(0, 10)}`;

  // v10 of @simplewebauthn/server flattens the credential fields onto
  // registrationInfo directly (no nested `.credential` object), and the
  // type no longer exposes `transports` — we store an empty array and
  // populate it later if we add a "set device nickname" endpoint.
  await prisma.$executeRaw`
    INSERT INTO webauthn_credentials
      (id, user_id, tenant_id, public_key, counter, device_name, transports, last_used_at, created_at)
    VALUES
      (${credentialId}, ${ctx.userId}::uuid, ${ctx.tenantId}::uuid, ${publicKey}, ${counter}, ${deviceName}, ARRAY[]::text[], NOW(), NOW())
    ON CONFLICT (id) DO UPDATE SET
      counter = EXCLUDED.counter,
      last_used_at = NOW()
  `;

  // Single-use challenge: delete after use.
  await prisma.$executeRaw`
    DELETE FROM webauthn_challenges
    WHERE user_id = ${ctx.userId}::uuid AND kind = 'register'
  `;

  return NextResponse.json({
    ok: true,
    credentialId,
    deviceName,
  });
}
