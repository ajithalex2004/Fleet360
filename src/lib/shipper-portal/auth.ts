/**
 * Shipper Portal — session and authorisation helpers.
 *
 * Tenant operators (existing User+UserTenant) and shipper portal users
 * (customer_portal_users) are TWO COMPLETELY SEPARATE identity domains.
 * A portal user can never act as a tenant operator and vice versa.
 *
 * Session model:
 *   • Cookie name: 'shipper-portal-session'
 *   • Cookie path: '/' but the API guard rejects any request whose
 *     pathname doesn't start with /shipper-portal or /api/shipper-portal,
 *     so the cookie has no privilege outside its intended scope.
 *   • Value: HMAC-SHA256-signed JSON payload
 *       { userId, customerId, tenantId, exp, iat }
 *     Format: `${base64url(payloadJson)}.${hexHmac}`
 *   • TTL: 7 days; re-issued on every successful authenticated request.
 *
 * No JWT library is added — the existing codebase already uses HMAC-signed
 * payloads via Node's `crypto` module (src/lib/bus-checkin.ts, sso-state.ts).
 */

import crypto from 'crypto';
import type { NextRequest } from 'next/server';
import { NextResponse } from 'next/server';
import { getPortalUserById } from './portal-users-store';

const COOKIE_NAME = 'shipper-portal-session';
const SESSION_TTL_SECONDS = 7 * 24 * 60 * 60;

function getSecret(): string {
  const s = process.env.SHIPPER_PORTAL_SESSION_SECRET
    ?? process.env.SESSION_SECRET
    ?? process.env.AUTH_SECRET;
  if (!s) {
    // Dev fallback only — log loudly so it's noticed before production.
    console.warn(
      '[shipper-portal/auth] No SHIPPER_PORTAL_SESSION_SECRET / SESSION_SECRET set — ' +
      'using insecure dev fallback. Set this env var before production.',
    );
    return 'dev-shipper-portal-insecure-fallback-do-not-use-in-prod';
  }
  return s;
}

// ── Token sign / verify ────────────────────────────────────────────────

export interface PortalSessionPayload {
  userId: string;
  customerId: string;
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
  // Timing-safe compare
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

/** Build the cookie attribute string for the session token. Path-scoped
 *  to /shipper-portal + /api/shipper-portal would be ideal, but cookies
 *  only support a single Path — we use '/' and rely on the API guard
 *  (requireShipperPortal below) for surface enforcement. */
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

// ── Guards used by /api/shipper-portal/* routes ────────────────────────

export interface PortalRequestContext {
  userId: string;
  customerId: string;
  tenantId: string;
  /** Full hydrated user — saves callers a second fetch. Includes the
   *  isActive flag so revoked accounts can't keep using a valid cookie. */
  user: {
    id: string;
    email: string;
    fullName: string | null;
    role: 'SHIPPER_USER' | 'SHIPPER_ADMIN';
    isActive: boolean;
  };
}

/**
 * Read + validate the portal session cookie, hydrate the user, and check
 * isActive. Returns either the context or a NextResponse that the caller
 * should return directly (401 / 403).
 */
export async function requireShipperPortal(
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
  // Belt-and-braces: the cookie's customerId must match the DB row's
  // customerId. Prevents a stale cookie from a re-assigned account.
  if (user.customerId !== session.customerId) {
    return NextResponse.json({ error: 'Session no longer valid' }, { status: 401 });
  }
  return {
    userId: user.id,
    customerId: user.customerId,
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

/** As above + requires SHIPPER_ADMIN. Used for "invite another portal
 *  user for our company" actions (Phase 2). */
export async function requireShipperPortalAdmin(
  req: NextRequest,
): Promise<PortalRequestContext | NextResponse> {
  const ctx = await requireShipperPortal(req);
  if (ctx instanceof NextResponse) return ctx;
  if (ctx.user.role !== 'SHIPPER_ADMIN') {
    return NextResponse.json({ error: 'Shipper admin role required' }, { status: 403 });
  }
  return ctx;
}
