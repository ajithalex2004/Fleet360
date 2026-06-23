/**
 * Sign + verify the short-lived SSO state cookie that tracks the in-flight
 * OIDC handshake. Same HMAC pattern as tenant-session.ts.
 *
 * Payload survives between /api/auth/sso/initiate and /api/auth/sso/callback,
 * carries the PKCE verifier + nonce + state + tenantId so the callback can
 * complete the exchange and bind the result to the right tenant.
 */

import crypto from 'crypto';

const SECRET =
  process.env.SESSION_SECRET ?? 'xl-mobility-dev-secret-change-in-production';

const TTL_MS = 10 * 60 * 1000;

export interface SsoStatePayload {
  tenantId: string;
  email: string;
  codeVerifier: string;
  state: string;
  nonce: string;
  returnTo: string;
  exp: number;
}

function hmac(data: string): string {
  return crypto.createHmac('sha256', SECRET).update(data).digest('hex');
}

function b64url(input: string | Buffer): string {
  const source = Buffer.isBuffer(input) ? input : Buffer.from(input, 'utf8');
  return source.toString('base64')
    .replace(/\+/g, '-').replace(/\//g, '_').replace(/=/g, '');
}

function fromB64url(input: string): string {
  const padded = input.replace(/-/g, '+').replace(/_/g, '/');
  const pad = padded.length % 4;
  return Buffer.from(pad ? padded + '='.repeat(4 - pad) : padded, 'base64').toString('utf8');
}

export async function signSsoState(payload: Omit<SsoStatePayload, 'exp'>): Promise<string> {
  const full: SsoStatePayload = { ...payload, exp: Date.now() + TTL_MS };
  const encoded = b64url(JSON.stringify(full));
  const sig = hmac(encoded);
  return `${encoded}.${sig}`;
}

export async function verifySsoState(token: string): Promise<SsoStatePayload | null> {
  try {
    const i = token.lastIndexOf('.');
    if (i < 0) return null;
    const encoded = token.slice(0, i);
    const sig     = token.slice(i + 1);
    const expected = hmac(encoded);
    if (expected.length !== sig.length) return null;
    if (!crypto.timingSafeEqual(Buffer.from(expected, 'hex'), Buffer.from(sig, 'hex'))) return null;

    const payload: SsoStatePayload = JSON.parse(fromB64url(encoded));
    if (!payload.exp || payload.exp < Date.now()) return null;
    return payload;
  } catch {
    return null;
  }
}
