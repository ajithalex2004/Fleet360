/**
 * Unified server-side session logout & durable revocation helper (M1-P0-3 + Track C).
 *
 * Shared by POST /api/auth/logout and DELETE /api/auth/session so every
 * logout path enforces identical guarantees:
 *  1. Same-origin CSRF validation (rejects foreign Origin, Origin: null, and
 *     Sec-Fetch-Site: cross-site with 403 before touching cookies, DB, or Redis).
 *  2. Verified token inspection across ALL session cookies (`xl-session`,
 *     `xl-driver-session`, `xl-impersonator-session`) AND `Authorization: Bearer`
 *     (supporting BOTH Next.js `xl-session` tokens via `SESSION_SECRET` AND Go
 *     backend HS256 JWTs via `JWT_SECRET`).
 *  3. Postgres-first atomic durable persistence (`public.revoked_session_tokens`):
 *     writes both `sid:<uuid>` (invalidating paired Next.js + Go tokens atomically)
 *     and `tok:<sha256>` (legacy / standalone fallback). If PostgreSQL fails,
 *     returns HTTP 503 with `{ ok: false, revoked: false, cookiesCleared: true }`
 *     and still clears all cookies.
 *  4. Upstash Redis hot-path mirror (`blocklist:sid:<uuid>` & `blocklist:sess:<sha256>`):
 *     if Redis fails while PostgreSQL succeeded, logs a structured warning and
 *     reports `{ ok: true, revoked: true, durable: true, redisMirrored: false,
 *     revocationMode: 'postgres' }` — Go and Node.js durable checks still reject
 *     the token immediately and self-heal Redis once Redis recovers.
 */

import { type NextRequest, NextResponse } from 'next/server';
import { bearerToken } from '@/lib/secure-compare';
import { validateSameOriginCsrf } from '@/lib/csrf-origin';
import { revokeSession } from '@/lib/session-blocklist';
import { verifySession } from '@/lib/tenant-session';
import { verifyJwtForBackend } from '@/lib/auth/jwt';
import {
  buildRevocationTokenKeys,
  markRevocationTokensSynced,
  revokeSessionTokensDurable,
  scheduleRevocationRedisSync,
  type DurableRevocationEntry,
} from '@/lib/auth/durable-session-revocation';
import { prisma } from '@/lib/prisma';
import { withTenantRls } from '@/lib/rls';
import { recordDrayageDriverLogout } from '@/lib/logistics/drayage-domain';

export const HTTP_ONLY_SESSION_COOKIES = [
  'xl-session',
  'xl-driver-session',
  'xl-impersonator-session',
] as const;

const NO_STORE_HEADERS = { 'Cache-Control': 'private, no-store' };
const MAX_CANDIDATE_TOKENS = 16;

interface VerifiedLogoutCandidate {
  rawToken: string;
  source: string;
  userId: string;
  tenantId: string;
  role: string;
  sid?: string;
  expiresAtMs: number;
}

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
  //    duplicates via getAll) and Authorization: Bearer header (capped to
  //    prevent CPU-exhaustion cookie-flooding loops).
  const candidateTokens = new Map<string, string>(); // rawToken -> source label
  for (const name of HTTP_ONLY_SESSION_COOKIES) {
    for (const cookie of request.cookies.getAll(name)) {
      if (candidateTokens.size >= MAX_CANDIDATE_TOKENS) break;
      const raw = cookie.value?.trim();
      if (raw && !candidateTokens.has(raw)) {
        candidateTokens.set(raw, name);
      }
    }
  }
  const bearer = bearerToken(request.headers)?.trim();
  if (bearer && !candidateTokens.has(bearer) && candidateTokens.size < MAX_CANDIDATE_TOKENS) {
    candidateTokens.set(bearer, 'authorization:bearer');
  }

  // 3. Verify every candidate token (skipping revocation read so a Redis outage
  //    never masks a valid token that needs durable revocation).
  const verified: VerifiedLogoutCandidate[] = [];
  for (const [rawToken, source] of candidateTokens.entries()) {
    const session = await verifySession(rawToken, { skipRevocationCheck: true }).catch(() => null);
    if (session) {
      if (source === 'xl-driver-session' || String(session.role || '').toUpperCase() === 'DRIVER') {
        driverLogoutTenantId = session.tenantId || null;
        driverLogoutUserId = session.userId || null;
      }
      verified.push({
        rawToken,
        source,
        userId: session.userId,
        tenantId: session.tenantId,
        role: session.role,
        sid: session.sid,
        expiresAtMs: session.expiresAt,
      });
      continue;
    }

    // Also accept valid Go backend HS256 Bearer JWTs (signed with JWT_SECRET).
    if (source === 'authorization:bearer') {
      const jwtClaims = await verifyJwtForBackend(rawToken).catch(() => null);
      if (jwtClaims) {
        verified.push({
          rawToken,
          source: 'authorization:bearer-jwt',
          userId: jwtClaims.userId,
          tenantId: jwtClaims.tenantId,
          role: jwtClaims.role,
          sid: jwtClaims.jti,
          expiresAtMs: jwtClaims.expiresAtMs,
        });
      }
    }
  }

  // 4. Persist durably to PostgreSQL (`revoked_session_tokens`) FIRST in one
  //    atomic transaction. If PostgreSQL fails, surface HTTP 503 honestly.
  const durableEntries: DurableRevocationEntry[] = [];
  for (const item of verified) {
    const tokenKeys = await buildRevocationTokenKeys(item.rawToken, item.sid);
    const expiresAt = new Date(item.expiresAtMs);
    for (const tokenKey of tokenKeys) {
      durableEntries.push({
        tokenKey,
        userId: item.userId,
        tenantId: item.tenantId,
        expiresAt,
        reason: `logout:${item.source}`,
      });
    }
  }

  const durableRes = await revokeSessionTokensDurable(durableEntries);
  if (!durableRes.ok) {
    console.error('[auth/logout] Durable PostgreSQL session revocation failed:', durableRes.error);
    const response = NextResponse.json(
      {
        ok: false,
        revoked: false,
        durable: false,
        redisMirrored: false,
        cookiesCleared: true,
        revokedCount: 0,
        failedCount: verified.length,
        error: 'Session revocation unavailable',
        message: 'Cookies were cleared, but durable server-side session revocation failed. Please try again.',
      },
      { status: 503, headers: NO_STORE_HEADERS },
    );
    clearSessionCookies(response);
    return response;
  }

  // 5. Mirror to Upstash Redis for sub-millisecond Edge middleware checks.
  //    PostgreSQL already persisted the revocation durably; a Redis mirror
  //    failure is logged and reported honestly (`redisMirrored: false`,
  //    `revocationMode: 'postgres'`) without denying logout completion.
  let redisMirroredCount = 0;
  let redisFailedCount = 0;
  let sawRedisUnconfigured = false;
  const redisFailures: string[] = [];
  const syncedDurableKeys: string[] = [];

  for (const item of verified) {
    const result = await revokeSession(item.rawToken, item.expiresAtMs, item.sid);
    if (!result.ok) {
      redisFailedCount += 1;
      redisFailures.push(`${item.source}: ${result.error}`);
    } else if (result.persisted === 'redis') {
      redisMirroredCount += 1;
      const keys = await buildRevocationTokenKeys(item.rawToken, item.sid);
      syncedDurableKeys.push(...keys);
    } else {
      sawRedisUnconfigured = true;
    }
  }

  if (syncedDurableKeys.length > 0) {
    void markRevocationTokensSynced(syncedDurableKeys);
  }

  if (redisFailedCount > 0) {
    console.warn(
      '[auth/logout] Durable Postgres revocation succeeded, but Redis mirror write failed (scheduling outbox sync):',
      redisFailures.join('; '),
    );
    scheduleRevocationRedisSync();
  }

  // 6. Best-effort driver shift cleanup (never blocks logout revocation response).
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

  const attempted = verified.length;
  const redisMirrored = attempted === 0 ? true : redisMirroredCount === attempted;
  const revocationMode =
    attempted === 0
      ? 'none'
      : redisMirrored && !sawRedisUnconfigured
        ? 'postgres+redis'
        : 'postgres';

  const response = NextResponse.json(
    {
      ok: true,
      revoked: true,
      durable: attempted > 0,
      redisMirrored,
      revocationMode,
      revokedCount: attempted,
      cookiesCleared: true,
      message: 'Logged out successfully.',
    },
    { status: 200, headers: NO_STORE_HEADERS },
  );
  clearSessionCookies(response);
  return response;
}
