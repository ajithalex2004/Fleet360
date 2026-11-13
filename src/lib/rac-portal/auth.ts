/**
 * Standalone Authenticated B2B RAC Portal — Session & Authorization Helpers.
 *
 * Separate identity domain (`rac-portal-session` HttpOnly HMAC-SHA256 cookie),
 * completely isolated from operator `xl-session` and lessee `leasing-portal-session`.
 */

import crypto from 'crypto';
import type { NextRequest } from 'next/server';
import { NextResponse } from 'next/server';
import { getRacPortalUserById, type RacPortalRole } from './portal-users-store';

export type { RacPortalRole };

const COOKIE_NAME = 'rac-portal-session';
const SESSION_TTL_SECONDS = 7 * 24 * 60 * 60;

function getSecret(): string {
  const portalSecret =
    process.env.RAC_PORTAL_SECRET ??
    process.env.RAC_PORTAL_SESSION_SECRET;
  const nextAuthSecret = process.env.NEXTAUTH_SECRET;
  const legacySecret = process.env.SESSION_SECRET ?? process.env.AUTH_SECRET;

  if (process.env.NODE_ENV === 'production') {
    const candidate = portalSecret ?? nextAuthSecret;
    if (!candidate || candidate.length < 32) {
      throw new Error(
        '[rac-portal/auth] Fatal: RAC_PORTAL_SECRET or NEXTAUTH_SECRET (>= 32 chars) must be configured in production.',
      );
    }
    return candidate;
  }

  const s = portalSecret ?? nextAuthSecret ?? legacySecret;
  if (!s) {
    return 'dev-rac-portal-insecure-fallback-do-not-use-in-prod';
  }
  return s;
}

export interface RacPortalSessionPayload {
  userId: string;
  customerId: string;
  tenantId: string;
  /** Session revocation version (`rac_portal_users.session_version`), defaults to 1. */
  sv?: number;
  iat: number;
  exp: number;
}

export function signRacPortalSession(
  payload: Omit<RacPortalSessionPayload, 'iat' | 'exp'>,
): { token: string; expiresAt: Date } {
  const iat = Math.floor(Date.now() / 1000);
  const exp = iat + SESSION_TTL_SECONDS;
  const full: RacPortalSessionPayload = {
    ...payload,
    sv: payload.sv ?? 1,
    iat,
    exp,
  };
  const payloadB64 = Buffer.from(JSON.stringify(full), 'utf8').toString('base64url');
  const sig = crypto.createHmac('sha256', getSecret()).update(payloadB64).digest('hex');
  return { token: `${payloadB64}.${sig}`, expiresAt: new Date(exp * 1000) };
}

export function verifyRacPortalSession(
  token: string | undefined | null,
): RacPortalSessionPayload | null {
  if (!token) return null;
  const dot = token.indexOf('.');
  if (dot < 0) return null;
  const payloadB64 = token.slice(0, dot);
  const sig = token.slice(dot + 1);
  const expected = crypto.createHmac('sha256', getSecret()).update(payloadB64).digest('hex');
  const a = Buffer.from(sig, 'hex');
  const b = Buffer.from(expected, 'hex');
  if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) return null;
  try {
    const payload = JSON.parse(
      Buffer.from(payloadB64, 'base64url').toString('utf8'),
    ) as RacPortalSessionPayload;
    if (typeof payload?.userId !== 'string' || typeof payload?.tenantId !== 'string') return null;
    if (typeof payload?.customerId !== 'string') return null;
    if (
      payload.sv !== undefined &&
      (typeof payload.sv !== 'number' || !Number.isInteger(payload.sv) || payload.sv < 1)
    ) {
      return null;
    }
    if (typeof payload?.exp !== 'number' || payload.exp < Math.floor(Date.now() / 1000)) return null;
    return payload;
  } catch {
    return null;
  }
}

export function buildRacSessionCookie(token: string): string {
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

export function buildClearRacSessionCookie(): string {
  const attrs = [`${COOKIE_NAME}=`, 'Path=/', 'Max-Age=0', 'HttpOnly', 'SameSite=Lax'];
  if (process.env.NODE_ENV === 'production') attrs.push('Secure');
  return attrs.join('; ');
}

export function readRacSessionFromRequest(req: NextRequest): RacPortalSessionPayload | null {
  const cookieHeader = req.headers.get('cookie') ?? '';
  const match = cookieHeader
    .split(';')
    .map((s) => s.trim())
    .find((s) => s.startsWith(`${COOKIE_NAME}=`));
  if (!match) return null;
  const token = decodeURIComponent(match.slice(COOKIE_NAME.length + 1));
  return verifyRacPortalSession(token);
}

export interface RacPortalRequestContext {
  userId: string;
  customerId: string;
  tenantId: string;
  user: {
    id: string;
    email: string;
    fullName: string | null;
    role: RacPortalRole;
    isActive: boolean;
    sessionVersion: number;
  };
}

export async function requireRacPortal(
  req: NextRequest,
): Promise<RacPortalRequestContext | NextResponse> {
  const session = readRacSessionFromRequest(req);
  if (!session) {
    return NextResponse.json({ error: 'Not authenticated' }, { status: 401 });
  }
  const user = await getRacPortalUserById(session.tenantId, session.userId);
  if (!user) {
    const res = NextResponse.json({ error: 'User no longer exists' }, { status: 401 });
    res.headers.set('Set-Cookie', buildClearRacSessionCookie());
    return res;
  }
  if (!user.isActive) {
    const res = NextResponse.json({ error: 'Account has been deactivated' }, { status: 403 });
    res.headers.set('Set-Cookie', buildClearRacSessionCookie());
    return res;
  }
  if (user.customerId !== session.customerId) {
    const res = NextResponse.json({ error: 'Session no longer valid' }, { status: 401 });
    res.headers.set('Set-Cookie', buildClearRacSessionCookie());
    return res;
  }
  if ((session.sv ?? 1) !== (user.sessionVersion ?? 1)) {
    const res = NextResponse.json(
      { error: 'Session has been revoked. Please sign in again.' },
      { status: 401 },
    );
    res.headers.set('Set-Cookie', buildClearRacSessionCookie());
    return res;
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
      sessionVersion: user.sessionVersion ?? 1,
    },
  };
}

export async function requireRacPortalAdmin(
  req: NextRequest,
): Promise<RacPortalRequestContext | NextResponse> {
  const ctx = await requireRacPortal(req);
  if (ctx instanceof NextResponse) return ctx;
  if (ctx.user.role !== 'RAC_B2B_ADMIN') {
    return NextResponse.json({ error: 'Corporate B2B Admin role required' }, { status: 403 });
  }
  return ctx;
}
