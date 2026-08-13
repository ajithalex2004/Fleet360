/**
 * lib/driver-session.ts
 *
 * Reads the driver-app session cookie and returns a TenantContext.
 * Used by the new driver-app API routes (shift, fuel, expenses) that
 * live under the PUBLIC_PREFIXES in middleware (which bypasses the
 * standard xl-session auth) and therefore don't get tenant headers
 * injected.
 *
 * Accepts BOTH xl-driver-session and xl-session — the demo flow
 * uses the admin cookie for the password login path until a proper
 * driver-password API lands. The biometric flow uses xl-driver-session.
 *
 * Mirrors the header shape that middleware would have set, so the
 * downstream `getTenantContextOrNull(req)` returns the same shape
 * whether auth came from middleware or this helper.
 */

import { NextResponse } from 'next/server';
import { verifySession } from '@/lib/tenant-session';

/**
 * Minimum cookie-reading surface required by the driver session helpers.
 * NextRequest satisfies this interface, as do lightweight test mocks.
 */
interface HasCookies {
  cookies: {
    get(name: string): { value?: string | undefined } | undefined;
  };
}

export interface DriverTenantContext {
  userId: string;
  tenantId: string;
  plan: string;
  role: string;
}

/**
 * Read and verify the session cookie from a driver-app request.
 * Returns null if no valid session is present.
 *
 * Cookie precedence: prefer `xl-driver-session` (the driver's
 * dedicated cookie), but fall back to `xl-session` if it's present.
 *
 * Both cookies are tried — if one is present but invalid (stale,
 * signed with a different secret, or simply malformed), the helper
 * still attempts the other before giving up. The previous
 * `driverToken || adminToken` short-circuit meant a stale
 * `xl-driver-session` would 401 the user even when a perfectly
 * valid `xl-session` was sitting right next to it in the cookie
 * jar — which is what the launcher was hitting on re-login.
 */
export async function getDriverTenantContext(
  req: HasCookies,
): Promise<DriverTenantContext | null> {
  const driverToken = req.cookies.get('xl-driver-session')?.value;
  const adminToken = req.cookies.get('xl-session')?.value;

  // Try the driver cookie first, then the admin cookie, regardless
  // of which is set. A cookie that's present but invalid should
  // not block the other one from being tried.
  for (const token of [driverToken, adminToken]) {
    if (!token) continue;
    const session = await verifySession(token).catch(() => null);
    if (session) {
      return {
        userId: session.userId,
        tenantId: session.tenantId,
        plan: session.plan,
        role: session.role ?? 'TENANT_ADMIN',
      };
    }
  }
  return null;
}

/**
 * Drop-in replacement for `getTenantContextOrNull(req)` for driver-app
 * routes. Reads the cookie, verifies the session, and returns a
 * TenantContext. If the session is missing/invalid, returns a 401
 * NextResponse instead (so the route handler can `return ctx ?? unauth()`
 * in one line).
 */
export async function requireDriverSession(
  req: HasCookies,
): Promise<DriverTenantContext | NextResponse> {
  const ctx = await getDriverTenantContext(req);
  if (!ctx) {
    return NextResponse.json(
      { error: 'session required' },
      { status: 401 },
    );
  }
  return ctx;
}
