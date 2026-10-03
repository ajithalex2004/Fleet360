/**
 * Step-up token: proof that the person behind a session passed a passkey
 * check in the last STEP_UP_TTL_MS. Issued by /api/auth/step-up/verify (and
 * on passkey registration), carried in the httpOnly STEP_UP_COOKIE, checked
 * by src/middleware.ts before the actions in STEP_UP_ROUTES.
 *
 * Bound to the session it was issued for: user, tenant and the session's
 * issue time. Signing in again, switching tenant or starting an
 * impersonation issues a new session, which a token from the old one does
 * not cover. `act` is who checked their passkey: the user, or during
 * impersonation the platform admin behind it.
 *
 * Signed with HMAC-SHA256 under a key derived from the session secret, so a
 * step-up token and a session token can never stand in for one another.
 *
 * Edge-runtime safe: Web Crypto only.
 */
import { requireSessionSecret } from '@/lib/session-secret';
import { STEP_UP_TTL_MS } from '@/lib/auth/step-up-policy';

export interface StepUpSubject {
  userId: string;
  tenantId: string;
  /** The session's issue time (ms), VerifiedSession.issuedAt. */
  issuedAt: number;
  /** Set during impersonation: the platform admin behind the session. */
  impersonatedBy?: string;
}

interface StepUpClaims {
  typ: 'step-up';
  uid: string;
  tid: string;
  sid: number;
  act: string;
  exp: number;
}

/** Who must pass the passkey check for a session: the impersonator, else the user. */
export const stepUpActor = (s: { userId: string; impersonatedBy?: string }) => s.impersonatedBy || s.userId;

const enc = new TextEncoder();
let keyPromise: Promise<CryptoKey> | null = null;
let keySecret: string | null = null;

async function key(): Promise<CryptoKey> {
  const secret = requireSessionSecret();
  if (keyPromise && keySecret === secret) return keyPromise;
  keySecret = secret;
  keyPromise = (async () => {
    const root = await crypto.subtle.importKey('raw', enc.encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
    const derived = await crypto.subtle.sign('HMAC', root, enc.encode('fleet360/step-up/v1'));
    return crypto.subtle.importKey('raw', derived, { name: 'HMAC', hash: 'SHA-256' }, false, ['sign', 'verify']);
  })();
  return keyPromise;
}

function b64url(bytes: Uint8Array): string {
  let bin = '';
  bytes.forEach((b) => { bin += String.fromCharCode(b); });
  return btoa(bin).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

function fromB64url(s: string): Uint8Array {
  const b64 = s.replace(/-/g, '+').replace(/_/g, '/');
  const bin = atob(b64 + '='.repeat((4 - (b64.length % 4)) % 4));
  return Uint8Array.from(bin, (c) => c.charCodeAt(0));
}

export async function signStepUp(subject: StepUpSubject, now = Date.now()): Promise<string> {
  const claims: StepUpClaims = {
    typ: 'step-up',
    uid: subject.userId,
    tid: subject.tenantId,
    sid: subject.issuedAt,
    act: stepUpActor(subject),
    exp: now + STEP_UP_TTL_MS,
  };
  const body = b64url(enc.encode(JSON.stringify(claims)));
  const sig = new Uint8Array(await crypto.subtle.sign('HMAC', await key(), enc.encode(body)));
  return `${body}.${b64url(sig)}`;
}

/** True when `token` is a current step-up for exactly this session. */
export async function verifyStepUp(token: string | null | undefined, subject: StepUpSubject, now = Date.now()): Promise<boolean> {
  if (!token) return false;
  const dot = token.indexOf('.');
  if (dot <= 0) return false;
  try {
    const body = token.slice(0, dot);
    const ok = await crypto.subtle.verify('HMAC', await key(), new Uint8Array(fromB64url(token.slice(dot + 1))), enc.encode(body));
    if (!ok) return false;
    const c = JSON.parse(new TextDecoder().decode(fromB64url(body))) as Partial<StepUpClaims>;
    return c.typ === 'step-up'
      && c.uid === subject.userId
      && c.tid === subject.tenantId
      && c.sid === subject.issuedAt
      && c.act === stepUpActor(subject)
      && typeof c.exp === 'number' && c.exp > now;
  } catch {
    return false;
  }
}
