/**
 * src/app/api/driver-app/auth/biometric/register/route.ts
 *
 * Begin registering a biometric credential for the currently signed-in
 * driver. Returns a WebAuthn PublicKeyCredentialCreationOptions challenge
 * that the client passes to navigator.credentials.create().
 *
 * Auth: the driver must already be signed in via the standard session
 * cookie (xl-driver-session). We don't allow a fresh registration
 * without a session — the credential is bound to the user id in the
 * session. The platform authenticator (TouchID / FaceID / Android
 * BiometricPrompt) provides the biometric factor; the session cookie
 * is the "something you have" part.
 *
 * Why WebAuthn instead of a custom biometric plugin:
 *   - WebAuthn is the W3C standard. iOS 14+ and Android 9+ expose
 *     platform authenticators that map to TouchID / FaceID / Android
 *     BiometricPrompt automatically — no per-OS native code.
 *   - The private key never leaves the device's secure enclave.
 *   - Phishing-resistant: the challenge is bound to the origin (RP ID)
 *     so a stolen credential can't be replayed against a fake server.
 *   - We get a real cryptographic identity for free; no need to store
 *     biometric templates ourselves (which would be a GDPR / PDPL
 *     liability in the UAE).
 *
 * Storage: the public key + credential ID are stored in
 * `webauthn_credentials` (one row per device, scoped to user). On
 * verify we look up by credential id and increment a counter — the
 * counter is the canonical WebAuthn anti-replay signal.
 */

import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { getTenantContextOrNull } from '@/lib/tenant-session';
import { generateRegistrationOptions } from '@simplewebauthn/server';

// Lazy import: we don't want to add @simplewebauthn/server as a hard dep
// for the admin app. The first registration in a tenant pulls it in.
let _rpID: string | null = null;
let _rpName = 'Fleet360 Driver';
let _origin: string | null = null;

async function rp() {
  if (_rpID && _origin) {
    return { rpID: _rpID, rpName: _rpName, origin: _origin };
  }
  // RP ID is the registrable domain. For local dev that's 'localhost'.
  // For production, the tenant's primary domain.
  const env = process.env.NEXT_PUBLIC_DRIVER_RP_ID
    || (process.env.NODE_ENV === 'development' ? 'localhost' : null);
  if (!env) {
    throw new Error('NEXT_PUBLIC_DRIVER_RP_ID is not configured');
  }
  _rpID = env;
  _origin = process.env.NEXT_PUBLIC_DRIVER_ORIGIN
    || (process.env.NODE_ENV === 'development' ? 'http://localhost:3000' : null);
  if (!_origin) {
    throw new Error('NEXT_PUBLIC_DRIVER_ORIGIN is not configured');
  }
  return { rpID: _rpID, rpName: _rpName, origin: _origin };
}

export async function POST(req: NextRequest) {
  const ctx = getTenantContextOrNull(req);
  if (!ctx) {
    return NextResponse.json({ error: 'session required' }, { status: 401 });
  }

  // Use the Prisma-generated client where possible. The webauthn
  // credentials table is custom (no model), so we go through raw SQL.
  const userId = ctx.userId;
  const existing = await prisma.$queryRaw<Array<{ id: string }>>`
    SELECT id FROM webauthn_credentials
    WHERE user_id = ${userId}::uuid
    ORDER BY created_at DESC
  `;
  const excludeCredentials = existing.map((c) => ({ id: c.id }));

  const { rpID, rpName, origin } = await rp();

  const options = await generateRegistrationOptions({
    rpName,
    rpID,
    // v10 of @simplewebauthn/server requires userID to be a stable
    // Uint8Array, not a string. We derive a stable 32-byte buffer
    // from the UUID by base64-encoding the hex representation and
    // slicing — this gives a deterministic 22-byte (176-bit) ID per
    // user that the platform authenticator stores in its keychain.
    // It's not a secret (it's the user id, just in a different
    // encoding) and the authenticator uses it for the userHandle
    // returned during login.
    userID: new TextEncoder().encode(userId),
    userName: ctx.userId,
    userDisplayName: 'Driver',
    timeout: 60_000,
    attestationType: 'none',
    authenticatorSelection: {
      // `platform` = use the device's built-in authenticator
      // (TouchID / FaceID / Android BiometricPrompt). `crossPlatform`
      // would allow security keys; we don't want that for a driver app
      // because the user would need to carry the key.
      authenticatorAttachment: 'platform',
      // `required` = the device MUST verify the user is present (face /
      // fingerprint / device PIN). `preferred` would let the device skip
      // biometric if unavailable. We want the strict mode for drivers
      // because the consequence of a stolen PIN is a stolen shift.
      userVerification: 'required',
      // `true` = the credential is bound to this device only. We want
      // this because drivers typically use one work phone; cross-device
      // roaming is a security risk.
      residentKey: 'preferred',
    },
    excludeCredentials,
  });

  // Persist the challenge so the finish endpoint can verify the signed
  // credential against it. We use a short-lived row in the same table.
  await prisma.$executeRaw`
    INSERT INTO webauthn_challenges (challenge, user_id, kind, expires_at)
    VALUES (${options.challenge}, ${userId}::uuid, 'register', NOW() + INTERVAL '2 minutes')
  `;

  return NextResponse.json(options);
}
