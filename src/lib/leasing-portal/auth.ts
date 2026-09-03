/**
 * Leasing Portal — session and authorisation helpers.
 *
 * Mirrors src/lib/shipper-portal/auth.ts exactly, adapted for lessees.
 *
 * Tenant operators (existing User+UserTenant) and leasing portal users
 * (lessee_portal_users) are TWO COMPLETELY SEPARATE identity domains. A
 * portal user can never act as a tenant operator and vice versa.
 *
 * Session model:
 *   • Cookie name: 'leasing-portal-session'
 *   • Cookie path: '/' but the middleware only lets /leasing-portal and
 *     /api/leasing-portal/ traffic through unauthenticated (see
 *     PUBLIC_PREFIXES in auth-route-policies.ts) — every other route stays
 *     gated on the staff xl-session cookie, so this cookie has no
 *     privilege outside its intended scope even though its Path is '/'.
 *   • Value: HMAC-SHA256-signed JSON payload
 *       { userId, lesseeId, tenantId, exp, iat }
 *     Format: `${base64url(payloadJson)}.${hexHmac}`
 *   • TTL: 7 days; re-issued on every successful authenticated request.
 *
 * No JWT library — same HMAC-signed-payload approach already used by
 * shipper-portal, bus-checkin.ts, and sso-state.ts.
 */

import crypto from 'crypto';
import type { NextRequest } from 'next/server';
import { NextResponse } from 'next/server';
import { getPortalUserById } from './portal-users-store';

const COOKIE_NAME = 'leasing-portal-session';
const SESSION_TTL_SECONDS = 7 * 24 * 60 * 60;

function getSecret(): string {
  const s = process.env.LEASING_PORTAL_SESSION_SECRET
    ?? process.env.SESSION_SECRET
    ?? process.env.AUTH_SECRET;
  if (!s) {
    console.warn(
      '[leasing-portal/auth] No LEASING_PORTAL_SESSION_SECRET / SESSION_SECRET set — ' +
      'using insecure dev fallback. Set this env var before production.',
    );
    return 'dev-leasing-portal-insecure-fallback-do-not-use-in-prod';
  }
  return s;
}

// ── Token sign / verify ────────────────────────────────────────────────

export interface PortalSessionPayload {
  userId: string;
  lesseeId: string;
  tenantId: string;
  /** Issued-at — unix seconds */
  iat: number;
  /** Expires-at — unix seconds */
  exp: number;
}

export function signPortalSession(
  payload: Omit<PortalSessionPayload, 'iat' | 'exp'>,
): { token: string; expiresAt: Date } {
  const iat = Math.floor(Date.now() / 1000);
  const exp = iat + SESSION_TTL_SECONDS;
  const full: PortalSessionPayload = { ...payload, iat, exp };
  const payloadBytes = Buffer.from(JSON.stringify(full), 'utf8');
  const payloadB64 = payloadBytes.toString('base64url');
  const sig = crypto
    .createHmac('sha256', getSecret())
    .update(payloadB64)
    .digest('hex');
  return { token: `${payloadB64}.${sig}`, expiresAt: new Date(exp * 1000) };
}

export function verifyPortalSession(token: string | undefined | null): PortalSessionPayload | null {
  if (!token) return null;
  const dot = token.indexOf('.');
  if (dot < 0) return null;
  const payloadB64 = token.slice(0, dot);
  const sig = token.slice(dot + 1);
  const expected = crypto
    .createHmac('sha256', getSecret())
    .update(payloadB64)
    .digest('hex');
  const a = Buffer.from(sig, 'hex');
  const b = Buffer.from(expected, 'hex');
  if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) return null;
  try {
    const payload = JSON.parse(Buffer.from(payloadB64, 'base64url').toString('utf8')) as PortalSessionPayload;
    if (typeof payload?.userId !== 'string' || typeof payload?.tenantId !== 'string') return null;
    if (typeof payload?.exp !== 'number' || payload.exp < Math.floor(Date.now() / 1000)) return null;
    return payload;
  } catch {
    return null;
  }
}

// ── Cookie helpers ─────────────────────────────────────────────────────

export function buildSessionCookie(token: string): string {
  const attrs = [
    `${COOKIE_NAME}=${token}`,
    'Path=/',
    `Max-Age=${SESSION_TTL_SECONDS}`,
    'HttpOnly',
    'SameSite=Lax',
  ];
  if (process.env.NODE_ENV === 'production') attrs.push('Secure');
  return attrs.join('; ');
}

export function buildClearSessionCookie(): string {
  return `${COOKIE_NAME}=; Path=/; Max-Age=0; HttpOnly; SameSite=Lax`;
}

export function readSessionFromRequest(req: NextRequest): PortalSessionPayload | null {
  const cookieHeader = req.headers.get('cookie') ?? '';
  const match = cookieHeader.split(';').map(s => s.trim()).find(s => s.startsWith(`${COOKIE_NAME}=`));
  if (!match) return null;
  const token = decodeURIComponent(match.slice(COOKIE_NAME.length + 1));
  return verifyPortalSession(token);
}

// ── Guards used by /api/leasing-portal/* routes ────────────────────────

export interface PortalRequestContext {
  userId: string;
  lesseeId: string;
  tenantId: string;
  user: {
    id: string;
    email: string;
    fullName: string | null;
    role: 'LESSEE_USER' | 'LESSEE_ADMIN';
    isActive: boolean;
  };
}

/**
 * Read + validate the portal session cookie, hydrate the user, and check
 * isActive. Returns either the context or a NextResponse that the caller
 * should return directly (401 / 403).
 */
export async function requireLeasingPortal(
  req: NextRequest,
): Promise<PortalRequestContext | NextResponse> {
  const session = readSessionFromRequest(req);
  if (!session) {
    return NextResponse.json({ error: 'Not authenticated' }, { status: 401 });
  }
  const user = await getPortalUserById(session.tenantId, session.userId);
  if (!user) {
    return NextResponse.json({ error: 'User no longer exists' }, { status: 401 });
  }
  if (!user.isActive) {
    return NextResponse.json({ error: 'Account has been deactivated' }, { status: 403 });
  }
  // Belt-and-braces: the cookie's lesseeId must match the DB row's
  // lesseeId. Prevents a stale cookie from a re-assigned account.
  if (user.lesseeId !== session.lesseeId) {
    return NextResponse.json({ error: 'Session no longer valid' }, { status: 401 });
  }
  return {
    userId: user.id,
    lesseeId: user.lesseeId,
    tenantId: user.tenantId,
    user: {
      id: user.id,
      email: user.email,
      fullName: user.fullName,
      role: user.role,
      isActive: user.isActive,
    },
  };
}

/** As above + requires LESSEE_ADMIN. Used for "invite another portal user
 *  for our company" actions on corporate (B2B) lessee accounts. */
export async function requireLeasingPortalAdmin(
  req: NextRequest,
): Promise<PortalRequestContext | NextResponse> {
  const ctx = await requireLeasingPortal(req);
  if (ctx instanceof NextResponse) return ctx;
  if (ctx.user.role !== 'LESSEE_ADMIN') {
    return NextResponse.json({ error: 'Lessee admin role required' }, { status: 403 });
  }
  return ctx;
}
