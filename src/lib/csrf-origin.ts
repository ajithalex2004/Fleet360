/**
 * Same-origin CSRF validation for state-changing auth/session routes that are
 * exempt from operator session middleware (e.g. POST /api/auth/logout,
 * DELETE /api/auth/session).
 *
 * Defense-in-depth rules:
 *  1. Allowlist is derived strictly from server configuration
 *     (NEXT_PUBLIC_APP_URL, optional TRUSTED_APP_ORIGINS, and explicit
 *     Capacitor mobile WebView origins). NEVER trusts client-injectable
 *     X-Forwarded-Host, X-Forwarded-Proto, or Host headers.
 *     (Only when NEXT_PUBLIC_APP_URL is unset — local dev/test — falls back
 *     to request.nextUrl.origin.)
 *  2. Reject `Sec-Fetch-Site: cross-site` unless the `Origin` is an explicitly
 *     allowlisted first-party mobile WebView (Capacitor) origin.
 *  3. Whenever `Origin` is present (including `Origin: null` from sandboxed
 *     iframes or cross-site forms with `no-referrer`), it MUST exactly match
 *     an allowlisted first-party origin.
 *  4. When `Origin` is absent and `Referer` is present, the parsed `Referer`
 *     origin MUST exactly match an allowlisted first-party origin.
 *  5. When BOTH `Origin` and `Referer` are absent:
 *       - Allow if `Sec-Fetch-Site === 'same-origin'`.
 *       - Allow if `Authorization: Bearer <token>` is present (browsers never
 *         auto-attach Authorization cross-site).
 *       - Allow if NO session cookies are present (idempotent no-op).
 *       - Otherwise FAIL CLOSED (403): refuse cookie-authenticated state-
 *         changing requests that lack same-origin proof.
 */

import type { NextRequest } from 'next/server';
import { bearerToken } from '@/lib/secure-compare';

const MOBILE_WEBVIEW_ORIGINS = new Set([
  'https://localhost2',
  'capacitor://localhost2',
  'https://localhost',
  'capacitor://localhost',
]);

const SESSION_COOKIE_NAMES = [
  'xl-session',
  'xl-driver-session',
  'xl-impersonator-session',
] as const;

function allowedOriginsForRequest(request: NextRequest): Set<string> {
  const allowed = new Set<string>(MOBILE_WEBVIEW_ORIGINS);
  let hasConfiguredOrigin = false;

  const configured = process.env.NEXT_PUBLIC_APP_URL?.trim();
  if (configured) {
    try {
      allowed.add(new URL(configured).origin);
      hasConfiguredOrigin = true;
    } catch {
      // ignore invalid env value
    }
  }

  const extraOrigins = process.env.TRUSTED_APP_ORIGINS?.trim();
  if (extraOrigins) {
    for (const raw of extraOrigins.split(',')) {
      const trimmed = raw.trim();
      if (!trimmed) continue;
      try {
        allowed.add(new URL(trimmed).origin);
        hasConfiguredOrigin = true;
      } catch {
        // ignore invalid entry
      }
    }
  }

  // Only fall back to request.nextUrl.origin in local dev/test when no
  // canonical app origin is configured. Never trust X-Forwarded-Host or Host.
  if (!hasConfiguredOrigin && process.env.NODE_ENV !== 'production') {
    if (request.nextUrl?.origin && request.nextUrl.origin !== 'null') {
      allowed.add(request.nextUrl.origin);
    }
  }

  return allowed;
}

function hasAnySessionCookie(request: NextRequest): boolean {
  for (const name of SESSION_COOKIE_NAMES) {
    if (request.cookies.getAll(name).some((c) => Boolean(c.value?.trim()))) return true;
  }
  return false;
}

export function validateSameOriginCsrf(
  request: NextRequest,
): { ok: true } | { ok: false; reason: string } {
  const allowed = allowedOriginsForRequest(request);
  const origin = request.headers.get('origin')?.trim() ?? null;
  const referer = request.headers.get('referer')?.trim() ?? null;
  const secFetchSite = request.headers.get('sec-fetch-site')?.trim().toLowerCase() ?? null;

  // 1. Explicit Fetch Metadata cross-site block (except allowlisted Capacitor WebView origin)
  if (secFetchSite === 'cross-site') {
    if (!origin || !MOBILE_WEBVIEW_ORIGINS.has(origin)) {
      return { ok: false, reason: 'cross-site Sec-Fetch-Site header rejected' };
    }
  }

  // 2. Validate Origin header whenever present (explicitly rejects Origin: null)
  if (origin !== null) {
    if (origin === '' || origin === 'null' || !allowed.has(origin)) {
      return { ok: false, reason: `untrusted Origin header (${origin || 'empty'})` };
    }
    return { ok: true };
  }

  // 3. Validate Referer header when Origin is absent
  if (referer !== null) {
    try {
      const refOrigin = new URL(referer).origin;
      if (!allowed.has(refOrigin)) {
        return { ok: false, reason: `untrusted Referer origin (${refOrigin})` };
      }
      return { ok: true };
    } catch {
      return { ok: false, reason: 'malformed Referer header' };
    }
  }

  // 4. Strict Fetch Metadata same-origin proof when Origin and Referer are both absent
  if (secFetchSite === 'same-origin') {
    return { ok: true };
  }

  // 5. Explicit Bearer token (never auto-sent by browsers cross-site)
  if (bearerToken(request.headers)) {
    return { ok: true };
  }

  // 6. Cookie-free idempotent call carries no ambient browser credentials to forge
  if (!hasAnySessionCookie(request)) {
    return { ok: true };
  }

  // 7. Fail closed: cookie-authenticated request with zero same-origin proof
  return {
    ok: false,
    reason: 'missing Origin, Referer, or Sec-Fetch-Site: same-origin on cookie-authenticated request',
  };
}
