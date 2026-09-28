/**
 * Staff passkeys (WebAuthn) for step-up before high-impact admin actions
 * (src/lib/auth/step-up-policy.ts).
 *
 *   registration  a signed-in user adds a passkey. The first one needs a
 *                 re-authentication (reauthenticate() below); later ones a
 *                 step-up with an existing passkey, so a stolen session
 *                 cannot add its own.
 *   assertion     the user proves presence with a registered passkey
 *                 (user verification required: biometric or device PIN);
 *                 the caller then issues a step-up token.
 *
 * Challenges are single-use: consumed atomically (DELETE … RETURNING) before
 * the response is verified, valid for CHALLENGE_TTL_MS.
 *
 * The relying party (RP) comes from configuration, never from request
 * headers: WEBAUTHN_RP_ID + WEBAUTHN_ORIGINS, else NEXT_PUBLIC_APP_URL,
 * else localhost in development. Passkeys are bound to the RP ID they were
 * registered under; after a domain change users re-register (a platform
 * admin resets their passkeys first).
 *
 * Rows live in staff_passkeys / step_up_challenges, platform context only.
 */
import {
  generateAuthenticationOptions,
  generateRegistrationOptions,
  verifyAuthenticationResponse,
  verifyRegistrationResponse,
} from '@simplewebauthn/server';
import { prisma } from '@/lib/prisma';
import { withPlatformAdmin } from '@/lib/rls';
import { verifyPassword } from '@/lib/password-policy';
import { verifyRecoveryCode, verifyTotp } from '@/lib/totp';

export type RegistrationResponse = Parameters<typeof verifyRegistrationResponse>[0]['response'];
export type AuthenticationResponse = Parameters<typeof verifyAuthenticationResponse>[0]['response'];

export const CHALLENGE_TTL_MS = 2 * 60_000;
/** A user without a password (SSO) may register a first passkey this soon after signing in. */
export const RECENT_SIGN_IN_MS = 10 * 60_000;

export class PasskeyError extends Error {
  constructor(message: string, readonly status = 400, readonly code = 'passkey_error') {
    super(message);
  }
}

export interface RelyingParty {
  rpID: string;
  rpName: string;
  origins: string[];
}

/** The configured relying party, or null when passkeys are not configured here. */
export function relyingParty(env: NodeJS.ProcessEnv = process.env): RelyingParty | null {
  const rpName = 'Fleet360';
  const explicit = env.WEBAUTHN_RP_ID?.trim();
  if (explicit) {
    const origins = (env.WEBAUTHN_ORIGINS ?? '').split(',').map((o) => o.trim()).filter(Boolean);
    return { rpID: explicit, rpName, origins: origins.length ? origins : [`https://${explicit}`] };
  }
  const appUrl = env.NEXT_PUBLIC_APP_URL?.trim();
  if (appUrl) {
    try {
      const u = new URL(appUrl);
      return { rpID: u.hostname, rpName, origins: [u.origin] };
    } catch { /* fall through */ }
  }
  if (env.NODE_ENV !== 'production') {
    return { rpID: 'localhost', rpName, origins: ['http://localhost:3000'] };
  }
  return null;
}

export function requireRelyingParty(): RelyingParty {
  const rp = relyingParty();
  if (!rp) {
    throw new PasskeyError('Passkeys are not configured on this server (set WEBAUTHN_RP_ID and WEBAUTHN_ORIGINS).', 503, 'passkeys_not_configured');
  }
  return rp;
}

export interface PasskeySummary {
  id: string;
  deviceName: string;
  rpId: string;
  createdAt: Date;
  lastUsedAt: Date | null;
}

export async function listPasskeys(userId: string): Promise<PasskeySummary[]> {
  return withPlatformAdmin(prisma, (tx) => tx.staffPasskey.findMany({
    where: { userId },
    select: { id: true, deviceName: true, rpId: true, createdAt: true, lastUsedAt: true },
    orderBy: { createdAt: 'asc' },
  }));
}

/** How many passkeys the user has: under any RP, and usable with this one. */
export async function passkeyCounts(userId: string, rpId: string): Promise<{ total: number; here: number }> {
  return withPlatformAdmin(prisma, async (tx) => ({
    total: await tx.staffPasskey.count({ where: { userId } }),
    here: await tx.staffPasskey.count({ where: { userId, rpId } }),
  }));
}

async function saveChallenge(userId: string, challenge: string, kind: 'register' | 'assert'): Promise<void> {
  await withPlatformAdmin(prisma, async (tx) => {
    await tx.stepUpChallenge.deleteMany({ where: { userId, expiresAt: { lt: new Date() } } });
    await tx.stepUpChallenge.create({
      data: { challenge, userId, kind, expiresAt: new Date(Date.now() + CHALLENGE_TTL_MS) },
    });
  });
}

/** The challenge the browser signed, from clientDataJSON. */
function signedChallenge(response: { response?: { clientDataJSON?: unknown } } | null | undefined): string {
  const raw = response?.response?.clientDataJSON;
  if (typeof raw !== 'string') throw new PasskeyError('Malformed passkey response.');
  try {
    const client = JSON.parse(Buffer.from(raw, 'base64url').toString('utf8')) as { challenge?: unknown };
    if (typeof client.challenge !== 'string' || !client.challenge) throw new Error('no challenge');
    return client.challenge;
  } catch {
    throw new PasskeyError('Malformed passkey response.');
  }
}

/** Consume a challenge issued to this user for this ceremony: single use, unexpired. */
async function consumeChallenge(userId: string, challenge: string, kind: 'register' | 'assert'): Promise<void> {
  const rows = await withPlatformAdmin(prisma, (tx) => tx.$queryRawUnsafe<Array<{ challenge: string }>>(
    `DELETE FROM step_up_challenges
      WHERE challenge = $1 AND user_id = $2 AND kind = $3 AND expires_at > now()
      RETURNING challenge`,
    challenge, userId, kind,
  ));
  if (rows.length !== 1) {
    throw new PasskeyError('This passkey request has expired or was already used. Try again.', 400, 'challenge_invalid');
  }
}

// ── Re-authentication for a first passkey ────────────────────────────────────

export type ReauthMethod = 'password' | 'password+mfa' | 'recent-sign-in';

interface CredentialRow {
  email: string;
  username: string;
  password_hash: string | null;
  mfa_enabled: boolean | null;
  mfa_secret: string | null;
  mfa_recovery_codes: string[] | null;
}

async function credentialRow(userId: string): Promise<CredentialRow | null> {
  const rows = await withPlatformAdmin(prisma, (tx) => tx.$queryRawUnsafe<CredentialRow[]>(
    `SELECT email, username, password_hash, mfa_enabled, mfa_secret, mfa_recovery_codes
       FROM "User" WHERE id = $1 AND is_active = true LIMIT 1`,
    userId,
  ));
  return rows[0] ?? null;
}

/** What a user must present to register their first passkey. */
export async function reauthMethod(userId: string): Promise<ReauthMethod> {
  const row = await credentialRow(userId);
  if (!row?.password_hash) return 'recent-sign-in';
  return row.mfa_enabled ? 'password+mfa' : 'password';
}

export interface ReauthInput {
  password?: string;
  mfaCode?: string;
  recoveryCode?: string;
}

/**
 * Re-authenticate before a first passkey: the password (and the
 * authenticator or a recovery code when MFA is on); for a user without a
 * password (SSO), a session signed in within RECENT_SIGN_IN_MS.
 */
export async function reauthenticate(userId: string, input: ReauthInput, sessionIssuedAt: number, now = Date.now()): Promise<void> {
  const row = await credentialRow(userId);
  if (!row) throw new PasskeyError('User not found or inactive.', 404, 'user_not_found');
  if (!row.password_hash) {
    if (now - sessionIssuedAt > RECENT_SIGN_IN_MS) {
      throw new PasskeyError('Sign out and sign in again, then add your passkey within 10 minutes.', 401, 'recent_sign_in_required');
    }
    return;
  }
  if (!input.password || !verifyPassword(input.password, row.password_hash)) {
    throw new PasskeyError('Incorrect password.', 401, 'reauth_failed');
  }
  if (!row.mfa_enabled) return;
  const code = input.mfaCode?.trim();
  if (code && row.mfa_secret && verifyTotp(row.mfa_secret, code)) return;
  const stored = Array.isArray(row.mfa_recovery_codes) ? row.mfa_recovery_codes : [];
  const consumed = input.recoveryCode ? verifyRecoveryCode(input.recoveryCode, stored) : null;
  if (!consumed) throw new PasskeyError('Enter your authenticator code or a recovery code.', 401, 'mfa_required');
  await withPlatformAdmin(prisma, (tx) => tx.$executeRawUnsafe(
    `UPDATE "User" SET mfa_recovery_codes = $1::jsonb, "updatedAt" = NOW() WHERE id = $2`,
    JSON.stringify(stored.filter((h) => h !== consumed)), userId,
  ));
}

// ── Registration ─────────────────────────────────────────────────────────────

export async function startRegistration(userId: string, rp: RelyingParty) {
  const row = await credentialRow(userId);
  if (!row) throw new PasskeyError('User not found or inactive.', 404, 'user_not_found');
  const existing = await withPlatformAdmin(prisma, (tx) => tx.staffPasskey.findMany({
    where: { userId, rpId: rp.rpID },
    select: { id: true, transports: true },
  }));
  const options = await generateRegistrationOptions({
    rpName: rp.rpName,
    rpID: rp.rpID,
    userID: new TextEncoder().encode(userId),
    userName: row.email || row.username,
    userDisplayName: row.username || row.email,
    timeout: CHALLENGE_TTL_MS,
    attestationType: 'none',
    // Platform authenticators (Touch ID, Windows Hello, Android) and
    // security keys alike; user verification (biometric or PIN) required.
    authenticatorSelection: { residentKey: 'preferred', userVerification: 'required' },
    excludeCredentials: existing.map((c) => ({ id: c.id, transports: c.transports as never })),
  });
  await saveChallenge(userId, options.challenge, 'register');
  return options;
}

export async function finishRegistration(
  userId: string,
  response: RegistrationResponse,
  deviceName: string | undefined,
  rp: RelyingParty,
): Promise<{ id: string; deviceName: string }> {
  const challenge = signedChallenge(response);
  await consumeChallenge(userId, challenge, 'register');
  let verification;
  try {
    verification = await verifyRegistrationResponse({
      response,
      expectedChallenge: challenge,
      expectedOrigin: rp.origins,
      expectedRPID: rp.rpID,
      requireUserVerification: true,
    });
  } catch (err) {
    throw new PasskeyError(`Passkey could not be verified: ${err instanceof Error ? err.message : String(err)}`);
  }
  const info = verification.registrationInfo;
  if (!verification.verified || !info) throw new PasskeyError('Passkey could not be verified.');

  const name = (deviceName ?? '').trim().slice(0, 80) || `Passkey added ${new Date().toISOString().slice(0, 10)}`;
  const transports = Array.isArray(response.response?.transports) ? response.response.transports.map(String) : [];
  const taken = await withPlatformAdmin(prisma, async (tx) => {
    if (await tx.staffPasskey.findUnique({ where: { id: info.credentialID }, select: { id: true } })) return true;
    await tx.staffPasskey.create({
      data: {
        id: info.credentialID,
        userId,
        rpId: rp.rpID,
        publicKey: Buffer.from(info.credentialPublicKey).toString('base64'),
        counter: BigInt(info.counter),
        transports,
        deviceName: name,
      },
    });
    return false;
  });
  if (taken) throw new PasskeyError('This passkey is already registered.', 409, 'passkey_exists');
  return { id: info.credentialID, deviceName: name };
}

// ── Assertion (step-up) ──────────────────────────────────────────────────────

/** Options for a passkey check, or null when the user has no passkey for this RP. */
export async function startAssertion(userId: string, rp: RelyingParty) {
  const passkeys = await withPlatformAdmin(prisma, (tx) => tx.staffPasskey.findMany({
    where: { userId, rpId: rp.rpID },
    select: { id: true, transports: true },
  }));
  if (passkeys.length === 0) return null;
  const options = await generateAuthenticationOptions({
    rpID: rp.rpID,
    timeout: CHALLENGE_TTL_MS,
    userVerification: 'required',
    allowCredentials: passkeys.map((c) => ({ id: c.id, transports: c.transports as never })),
  });
  await saveChallenge(userId, options.challenge, 'assert');
  return options;
}

/** Verify a passkey check by `userId`; throws PasskeyError when it fails. */
export async function finishAssertion(userId: string, response: AuthenticationResponse, rp: RelyingParty): Promise<{ passkeyId: string }> {
  const challenge = signedChallenge(response);
  await consumeChallenge(userId, challenge, 'assert');
  const credentialId = typeof response?.id === 'string' ? response.id : '';
  const passkey = await withPlatformAdmin(prisma, (tx) => tx.staffPasskey.findFirst({
    where: { id: credentialId, userId, rpId: rp.rpID },
  }));
  if (!passkey) throw new PasskeyError('This passkey is not registered to your account.', 400, 'unknown_passkey');

  let verification;
  try {
    verification = await verifyAuthenticationResponse({
      response,
      expectedChallenge: challenge,
      expectedOrigin: rp.origins,
      expectedRPID: rp.rpID,
      authenticator: {
        credentialID: passkey.id,
        credentialPublicKey: new Uint8Array(Buffer.from(passkey.publicKey, 'base64')),
        counter: Number(passkey.counter),
        transports: passkey.transports as never,
      },
      requireUserVerification: true,
    });
  } catch (err) {
    throw new PasskeyError(`Passkey check failed: ${err instanceof Error ? err.message : String(err)}`, 401, 'assertion_failed');
  }
  if (!verification.verified) throw new PasskeyError('Passkey check failed.', 401, 'assertion_failed');

  await withPlatformAdmin(prisma, (tx) => tx.staffPasskey.update({
    where: { id: passkey.id },
    data: { counter: BigInt(verification.authenticationInfo.newCounter), lastUsedAt: new Date() },
  }));
  return { passkeyId: passkey.id };
}

// ── Removal ──────────────────────────────────────────────────────────────────

/** Remove one of the user's own passkeys; false when it is not theirs. */
export async function removePasskey(userId: string, passkeyId: string): Promise<boolean> {
  const { count } = await withPlatformAdmin(prisma, (tx) => tx.staffPasskey.deleteMany({ where: { id: passkeyId, userId } }));
  return count > 0;
}

/** Remove every passkey of a user (a platform admin's reset after a lost device). */
export async function removeAllPasskeys(userId: string): Promise<number> {
  const { count } = await withPlatformAdmin(prisma, async (tx) => {
    await tx.stepUpChallenge.deleteMany({ where: { userId } });
    return tx.staffPasskey.deleteMany({ where: { userId } });
  });
  return count;
}
