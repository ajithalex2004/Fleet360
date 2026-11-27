export const dynamic = 'force-dynamic';

import { NextRequest, NextResponse } from 'next/server';
import { requireAuthorizedTenant } from '@/lib/tenant-context';
import { revokeSessions } from '@/lib/auth/session-revocation';
import { validateSameOriginCsrf } from '@/lib/csrf-origin';
import { bearerToken } from '@/lib/secure-compare';
import { verifySession } from '@/lib/tenant-session';
import { verifyJwtForBackend } from '@/lib/auth/jwt';
import {
  SESSION_SID_KEY_PREFIX,
  revokeSession,
  revokeSessionKeyInRedis,
} from '@/lib/session-blocklist';
import {
  DURABLE_SID_PREFIX,
  buildRevocationTokenKeys,
  markRevocationTokensSynced,
  revokeSessionTokensDurable,
  scheduleRevocationRedisSync,
  type DurableRevocationEntry,
} from '@/lib/auth/durable-session-revocation';
import { HTTP_ONLY_SESSION_COOKIES } from '@/lib/auth/logout-revocation';

export const runtime = 'nodejs';

const NO_STORE_HEADERS = { 'Cache-Control': 'private, no-store' };
const FALLBACK_SESSION_TTL_MS = 24 * 60 * 60 * 1000;
const MAX_CANDIDATE_TOKENS = 16;

/**
 * POST /api/auth/logout-all
 *
 * Sign out everywhere: every session of the signed-in user, in every tenant
 * and on every device, is revoked via `session_revocations` (within 60 s across
 * caches). In addition, the caller's current token(s) and shared `sid`/`jti` are
 * immediately written to `revoked_session_tokens` and Redis so this device and
 * its paired Go-backend JWT fail at t = 0 s (even within the same second).
 */
export async function POST(req: NextRequest) {
  const csrf = validateSameOriginCsrf(req);
  if (!csrf.ok) {
    return NextResponse.json(
      { ok: false, error: 'Forbidden', message: 'Cross-site logout-all request rejected.' },
      { status: 403, headers: NO_STORE_HEADERS },
    );
  }

  const authz = requireAuthorizedTenant({ headers: req.headers });
  if (!authz.ok) return NextResponse.json({ error: authz.error }, { status: authz.status, headers: NO_STORE_HEADERS });
  if (!authz.userId) return NextResponse.json({ error: 'Authentication required' }, { status: 401, headers: NO_STORE_HEADERS });

  await revokeSessions({ userId: authz.userId, reason: 'signed-out-everywhere', revokedBy: authz.userId });

  // Also immediately revoke the caller's current session tokens & paired sid/jti
  // so the active browser session and Go backend JWT cannot slip through a
  // same-second iat boundary or 60 s bulk cache window.
  const candidateTokens = new Map<string, string>();
  for (const name of HTTP_ONLY_SESSION_COOKIES) {
    for (const cookie of req.cookies.getAll(name)) {
      if (candidateTokens.size >= MAX_CANDIDATE_TOKENS) break;
      const raw = cookie.value?.trim();
      if (raw && !candidateTokens.has(raw)) candidateTokens.set(raw, name);
    }
  }
  const bearer = bearerToken(req.headers)?.trim();
  if (bearer && !candidateTokens.has(bearer) && candidateTokens.size < MAX_CANDIDATE_TOKENS) {
    candidateTokens.set(bearer, 'authorization:bearer');
  }

  const durableEntries: DurableRevocationEntry[] = [];
  const redisMirrorTargets: Array<{ keys: string[]; mirror: () => Promise<{ ok: boolean; persisted: string }> }> = [];

  for (const [rawToken, source] of candidateTokens.entries()) {
    const session = await verifySession(rawToken, { skipRevocationCheck: true }).catch(() => null);
    if (session) {
      const keys = await buildRevocationTokenKeys(rawToken, session.sid);
      const expiresAt = new Date(session.expiresAt);
      for (const tokenKey of keys) {
        durableEntries.push({
          tokenKey,
          userId: session.userId,
          tenantId: session.tenantId,
          expiresAt,
          reason: `signed-out-everywhere:${source}`,
        });
      }
      redisMirrorTargets.push({
        keys,
        mirror: () => revokeSession(rawToken, session.expiresAt, session.sid),
      });
      continue;
    }
    if (source === 'authorization:bearer') {
      const jwtClaims = await verifyJwtForBackend(rawToken).catch(() => null);
      if (jwtClaims) {
        const keys = await buildRevocationTokenKeys(rawToken, jwtClaims.jti);
        const expiresAt = new Date(jwtClaims.expiresAtMs);
        for (const tokenKey of keys) {
          durableEntries.push({
            tokenKey,
            userId: jwtClaims.userId,
            tenantId: jwtClaims.tenantId,
            expiresAt,
            reason: 'signed-out-everywhere:authorization:bearer-jwt',
          });
        }
        redisMirrorTargets.push({
          keys,
          mirror: () => revokeSession(rawToken, jwtClaims.expiresAtMs, jwtClaims.jti),
        });
      }
    }
  }

  const headerSid = req.headers.get('x-session-id')?.trim();
  if (headerSid && authz.tenantId) {
    const fallbackExpMs = Date.now() + FALLBACK_SESSION_TTL_MS;
    const sidKey = `${DURABLE_SID_PREFIX}${headerSid}`;
    durableEntries.push({
      tokenKey: sidKey,
      userId: authz.userId,
      tenantId: authz.tenantId,
      expiresAt: new Date(fallbackExpMs),
      reason: 'signed-out-everywhere:header-sid',
    });
    redisMirrorTargets.push({
      keys: [sidKey],
      mirror: () => revokeSessionKeyInRedis(`${SESSION_SID_KEY_PREFIX}${headerSid}`, fallbackExpMs),
    });
  }

  if (durableEntries.length > 0) {
    const durRes = await revokeSessionTokensDurable(durableEntries);
    if (!durRes.ok) {
      console.error('[auth/logout-all] Immediate per-token durable revocation failed (bulk scope revocation succeeded):', durRes.error);
    }
    const syncedKeys: string[] = [];
    let anyRedisFailed = false;
    for (const target of redisMirrorTargets) {
      const mRes = await target.mirror().catch(() => ({ ok: false, persisted: 'failed' }));
      if (!mRes.ok) anyRedisFailed = true;
      else if (mRes.persisted === 'redis') syncedKeys.push(...target.keys);
    }
    if (syncedKeys.length > 0) void markRevocationTokensSynced(syncedKeys);
    if (anyRedisFailed) scheduleRevocationRedisSync();
  }

  const secure = process.env.NODE_ENV === 'production';
  const res = NextResponse.json({ ok: true }, { headers: NO_STORE_HEADERS });
  for (const name of HTTP_ONLY_SESSION_COOKIES) {
    res.cookies.set(name, '', { httpOnly: true, sameSite: 'lax', secure, path: '/', maxAge: 0 });
  }
  res.cookies.set('xl-driver-vehicle-id', '', { httpOnly: false, sameSite: 'lax', secure, path: '/', maxAge: 0 });
  return res;
}
