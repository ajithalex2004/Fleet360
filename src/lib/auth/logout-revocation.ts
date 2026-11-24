/**
 * Unified server-side session logout & revocation helper (M1-P0-3).
 *
 * Shared by POST /api/auth/logout and DELETE /api/auth/session so every
 * logout path enforces identical guarantees:
 *  1. Same-origin CSRF validation (rejects foreign Origin, Origin: null, and
 *     Sec-Fetch-Site: cross-site with 403 before touching cookies or Redis).
 *  2. Verified token inspection using proper Base64URL decoding (via
 *     verifySession(..., { skipRevocationCheck: true }), eliminating the legacy
 *     `atob(payload + '==')` bug that failed silently on ~66.7% of sessions).
 *  3. Revokes ALL present session tokens: xl-session, xl-driver-session,
 *     xl-impersonator-session, and Authorization: Bearer <token>.
 *  4. Clears all session cookies defensively even if Redis fails.
 *  5. Fail-honest observability: if Redis is configured and ANY revocation
 *     write fails, logs an error and returns HTTP 503 with
 *     `{ ok: false, revoked: false, cookiesCleared: true }` — NEVER falsely
 *     reporting successful revocation.
 */

import { type NextRequest, NextResponse } from 'next/server';
import { bearerToken } from '@/lib/secure-compare';
import { validateSameOriginCsrf } from '@/lib/csrf-origin';
import { revokeSession } from '@/lib/session-blocklist';
import { verifySession } from '@/lib/tenant-session';
import { prisma } from '@/lib/prisma';
import { withTenantRls } from '@/lib/rls';
import { recordDrayageDriverLogout } from '@/lib/logistics/drayage-domain';

export const HTTP_ONLY_SESSION_COOKIES = [
  'xl-session',
  'xl-driver-session',
  'xl-impersonator-session',
] as const;

const NO_STORE_HEADERS = { 'Cache-Control': 'private, no-store' };

function clearSessionCookies(response: NextResponse): void {
  const secure = process.env.NODE_ENV === 'production';
  for (const name of HTTP_ONLY_SESSION_COOKIES) {
    response.cookies.set(name, '', {
      httpOnly: true,
      sameSite: 'lax',
      secure,
      maxAge: 0,
      path: '/',
    });
  }
  response.cookies.set('xl-driver-vehicle-id', '', {
    httpOnly: false,
    sameSite: 'lax',
    secure,
    maxAge: 0,
    path: '/',
  });
}

export async function performSessionLogout(request: NextRequest): Promise<NextResponse> {
  // 1. CSRF defense: refuse cross-site logout attempts before changing state.
  const csrf = validateSameOriginCsrf(request);
  if (!csrf.ok) {
    console.warn(`[auth/logout] CSRF check rejected request: ${csrf.reason}`);
    return NextResponse.json(
      { ok: false, error: 'Forbidden', message: 'Cross-site logout request rejected.' },
      { status: 403, headers: NO_STORE_HEADERS },
    );
  }

  const cookieVehicleId = request.cookies.get('xl-driver-vehicle-id')?.value || null;
  let driverLogoutTenantId: string | null = null;
  let driverLogoutUserId: string | null = null;

  // 2. Collect unique raw tokens from ALL session cookies (including shadowed
  //    duplicates via getAll) and Bearer header.
  const candidateTokens = new Map<string, string>(); // token -> source label
  for (const name of HTTP_ONLY_SESSION_COOKIES) {
    for (const cookie of request.cookies.getAll(name)) {
      const raw = cookie.value?.trim();
      if (raw && !candidateTokens.has(raw)) {
        candidateTokens.set(raw, name);
      }
    }
  }
  const bearer = bearerToken(request.headers)?.trim();
  if (bearer && !candidateTokens.has(bearer)) {
    candidateTokens.set(bearer, 'authorization:bearer');
  }

  // 3. Verify signature/expiry and persist revocation in Redis for every valid token.
  let attempted = 0;
  let revokedCount = 0;
  let failedCount = 0;
  let sawUnconfigured = false;
  const failures: string[] = [];

  for (const [rawToken, source] of candidateTokens.entries()) {
    // Skip revocation read so a Redis outage still attempts write and surfaces 503
    // rather than silently failing verifySession() and returning 200.
    const session = await verifySession(rawToken, { skipRevocationCheck: true }).catch(() => null);
    if (!session) continue;

    if (source === 'xl-driver-session' || String(session.role || '').toUpperCase() === 'DRIVER') {
      driverLogoutTenantId = session.tenantId || null;
      driverLogoutUserId = session.userId || null;
    }

    attempted += 1;
    const result = await revokeSession(rawToken, session.expiresAt);
    if (!result.ok) {
      failedCount += 1;
      failures.push(`${source}: ${result.error}`);
    } else if (result.persisted === 'redis') {
      revokedCount += 1;
    } else {
      sawUnconfigured = true;
    }
  }

  // 4. Best-effort driver shift cleanup (never blocks logout revocation response).
  if (driverLogoutTenantId && (driverLogoutUserId || cookieVehicleId)) {
    try {
      await withTenantRls(prisma, driverLogoutTenantId, async (tx) => {
        await recordDrayageDriverLogout(tx, {
          tenantId: driverLogoutTenantId!,
          driverId: driverLogoutUserId,
          vehicleId: cookieVehicleId,
        });
      });
    } catch (err) {
      console.warn('[auth/logout] driver logout cleanup failed (non-fatal):', err);
    }
  }

  // 5. Fail-honest response when Redis is configured and revocation write failed.
  if (failedCount > 0) {
    console.error('[auth/logout] Server-side session revocation failed:', failures.join('; '));
    const response = NextResponse.json(
      {
        ok: false,
        revoked: false,
        cookiesCleared: true,
        revokedCount,
        failedCount,
        error: 'Session revocation unavailable',
        message: 'Cookies were cleared, but server-side session revocation failed. Please try again.',
      },
      { status: 503, headers: NO_STORE_HEADERS },
    );
    clearSessionCookies(response);
    return response;
  }

  const revocationMode =
    attempted === 0 ? 'none' : sawUnconfigured && revokedCount === 0 ? 'cookie-only' : 'redis';

  const response = NextResponse.json(
    {
      ok: true,
      revoked: attempted === 0 ? true : revokedCount === attempted,
      revocationMode,
      revokedCount,
      cookiesCleared: true,
      message: 'Logged out successfully.',
    },
    { status: 200, headers: NO_STORE_HEADERS },
  );
  clearSessionCookies(response);
  return response;
}
