/**
 * Customer Portal — session and request guard.
 *
 * A separate identity domain from staff (`xl-session`) and the other portals:
 * an HttpOnly, HMAC-SHA256-signed `customer-portal-session` cookie carrying
 * the portal user, customer and tenant. Mirrors src/lib/rac-portal/auth.ts.
 *
 * requireCustomerPortal() re-reads the user on every request, so a
 * deactivated user, a moved user, a revoked session (session_version) or a
 * customer whose portal access was switched off is refused at once.
 */

import crypto from 'crypto';
import { NextResponse, type NextRequest } from 'next/server';
import { getPortalUserById, customerHasPortal, type PortalRole, type CustomerPortal } from './users';

const COOKIE_NAME = 'customer-portal-session';
const SESSION_TTL_SECONDS = 7 * 24 * 60 * 60;

function getSecret(): string {
  const portalSecret = process.env.CUSTOMER_PORTAL_SECRET;
  const nextAuthSecret = process.env.NEXTAUTH_SECRET;
  const sessionSecret = process.env.SESSION_SECRET ?? process.env.AUTH_SECRET;
  if (process.env.NODE_ENV === 'production') {
    const candidate = portalSecret ?? nextAuthSecret ?? sessionSecret;
    if (!candidate || candidate.length < 32) {
      throw new Error('[customer-portal] CUSTOMER_PORTAL_SECRET, NEXTAUTH_SECRET or SESSION_SECRET (>= 32 chars) must be set in production.');
    }
    // Domain-separate from other uses of a shared secret.
    return `customer-portal:${candidate}`;
  }
  return `customer-portal:${portalSecret ?? nextAuthSecret ?? sessionSecret ?? 'dev-customer-portal-insecure-fallback'}`;
}

export interface CustomerPortalSession {
  userId: string;
  customerId: string;
  tenantId: string;
  sv: number;
  iat: number;
  exp: number;
}

export function signCustomerPortalSession(p: { userId: string; customerId: string; tenantId: string; sv: number }): string {
  const iat = Math.floor(Date.now() / 1000);
  const full: CustomerPortalSession = { ...p, iat, exp: iat + SESSION_TTL_SECONDS };
  const body = Buffer.from(JSON.stringify(full), 'utf8').toString('base64url');
  const sig = crypto.createHmac('sha256', getSecret()).update(body).digest('hex');
  return `${body}.${sig}`;
}

export function verifyCustomerPortalSession(token: string | null | undefined): CustomerPortalSession | null {
  if (!token) return null;
  const dot = token.indexOf('.');
  if (dot < 1) return null;
  const body = token.slice(0, dot);
  const sig = token.slice(dot + 1);
  const expected = crypto.createHmac('sha256', getSecret()).update(body).digest('hex');
  const a = Buffer.from(sig, 'hex');
  const b = Buffer.from(expected, 'hex');
  if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) return null;
  try {
    const p = JSON.parse(Buffer.from(body, 'base64url').toString('utf8')) as CustomerPortalSession;
    if (typeof p.userId !== 'string' || typeof p.customerId !== 'string' || typeof p.tenantId !== 'string') return null;
    if (!Number.isInteger(p.sv) || p.sv < 1) return null;
    if (typeof p.exp !== 'number' || p.exp < Math.floor(Date.now() / 1000)) return null;
    return p;
  } catch {
    return null;
  }
}

function cookieAttrs(value: string, maxAge: number): string {
  const attrs = [`${COOKIE_NAME}=${value}`, 'Path=/', `Max-Age=${maxAge}`, 'HttpOnly', 'SameSite=Lax'];
  if (process.env.NODE_ENV === 'production') attrs.push('Secure');
  return attrs.join('; ');
}
export const buildCustomerPortalCookie = (token: string) => cookieAttrs(token, SESSION_TTL_SECONDS);
export const buildClearCustomerPortalCookie = () => cookieAttrs('', 0);

export function readCustomerPortalSession(req: NextRequest): CustomerPortalSession | null {
  const raw = (req.headers.get('cookie') ?? '')
    .split(';').map((s) => s.trim()).find((s) => s.startsWith(`${COOKIE_NAME}=`));
  if (!raw) return null;
  return verifyCustomerPortalSession(decodeURIComponent(raw.slice(COOKIE_NAME.length + 1)));
}

export interface CustomerPortalContext {
  tenantId: string;
  customerId: string;
  user: { id: string; email: string; fullName: string | null; role: PortalRole };
}

function refuse(status: number, error: string, clear = false): NextResponse {
  const res = NextResponse.json({ ok: false, error }, { status });
  if (clear) res.headers.set('Set-Cookie', buildClearCustomerPortalCookie());
  return res;
}

/**
 * Guard for portal API routes. `portal` is the portal the route belongs to;
 * `roles` (optional) restricts writes, e.g. ['ADMIN'] for managing sites.
 */
export async function requireCustomerPortal(
  req: NextRequest,
  opts: { portal: CustomerPortal; roles?: PortalRole[] },
): Promise<CustomerPortalContext | NextResponse> {
  const s = readCustomerPortalSession(req);
  if (!s) return refuse(401, 'Not signed in');
  const user = await getPortalUserById(s.tenantId, s.userId);
  if (!user || !user.isActive) return refuse(401, 'Your account is not active', true);
  if (user.customerId !== s.customerId) return refuse(401, 'Session no longer valid', true);
  if (user.sessionVersion !== s.sv) return refuse(401, 'Your session has ended. Sign in again.', true);
  if (!(await customerHasPortal(s.tenantId, s.customerId, opts.portal))) {
    return refuse(403, 'This portal is not enabled for your company');
  }
  if (opts.roles && !opts.roles.includes(user.role)) return refuse(403, 'Your role cannot do this');
  return {
    tenantId: s.tenantId,
    customerId: s.customerId,
    user: { id: user.id, email: user.email, fullName: user.fullName, role: user.role },
  };
}
