/**
 * lib/driver-session.ts
 *
 * Reads the driver-app session cookie or Authorization Bearer token and returns a TenantContext.
 */

import { NextResponse } from 'next/server';
import { verifySession } from '@/lib/tenant-session';

interface HasCookies {
  cookies: {
    get(name: string): { value?: string | undefined } | undefined;
  };
  headers?: {
    get(name: string): string | null;
  };
}

export interface DriverTenantContext {
  userId: string;
  tenantId: string;
  plan: string;
  role: string;
}

/**
 * Read and verify the session cookie or Authorization Bearer token from a driver-app request.
 * Returns null if no valid session is present.
 *
 * Precedence:
 *   1. Authorization: Bearer <token> header (used by Capacitor Android APK where cross-site cookies are blocked)
 *   2. `xl-driver-session` cookie
 *   3. `xl-session` cookie
 */
export async function getDriverTenantContext(
  req: HasCookies,
): Promise<DriverTenantContext | null> {
  const authHeader = req.headers?.get('authorization') || req.headers?.get('Authorization') || '';
  const bearerToken = authHeader.toLowerCase().startsWith('bearer ')
    ? authHeader.slice(7).trim()
    : undefined;
  const driverToken = req.cookies.get('xl-driver-session')?.value;
  const adminToken = req.cookies.get('xl-session')?.value;

  for (const token of [bearerToken, driverToken, adminToken]) {
    if (!token) continue;
    const session = await verifySession(token).catch(() => null);
    if (session) {
      return {
        userId: session.userId,
        tenantId: session.tenantId,
        plan: session.plan,
        role: session.role,
      };
    }
  }
  return null;
}

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

export async function requireDriverSessionForTenant(
  req: HasCookies,
  tenantId: string,
): Promise<DriverTenantContext | NextResponse> {
  const ctx = await requireDriverSession(req);
  if (ctx instanceof NextResponse) return ctx;
  if (ctx.tenantId !== tenantId) {
    return NextResponse.json(
      { error: 'session does not match tenant' },
      { status: 403 },
    );
  }
  return ctx;
}
