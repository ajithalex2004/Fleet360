export const dynamic = 'force-dynamic';

/**
 * POST /api/admin/impersonate/stop
 *
 * Restores the impersonator's original session from the
 * "xl-impersonator-session" cookie and clears the impersonation marker.
 * Anyone holding the impersonation cookie may call this — it only ever
 * restores back to the original (signed, verified) session.
 */

import { NextRequest, NextResponse } from 'next/server';
import { verifySession } from '@/lib/tenant-session';
import { bearerToken } from '@/lib/secure-compare';
import { validateSameOriginCsrf } from '@/lib/csrf-origin';
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
  verifySessionDurable,
  type DurableRevocationEntry,
} from '@/lib/auth/durable-session-revocation';
import { logAudit } from '@/lib/audit';
import { captureException } from '@/lib/sentry';

import { requireAuthorizedTenant } from '@/lib/tenant-context';
import { withAuditedAction } from '@/lib/audited-action';
export const runtime = 'nodejs';

const COOKIE_NAME              = 'xl-session';
const IMPERSONATOR_COOKIE_NAME = 'xl-impersonator-session';
const MAX_CANDIDATE_TOKENS     = 16;

async function revokeDiscardedImpersonationTokens(
  req: NextRequest,
  stashedToken: string,
  authz: { userId?: string | null; tenantId: string },
): Promise<{ ok: true } | { ok: false; error: string }> {
  const candidates = new Set<string>();
  for (const cookie of req.cookies.getAll(COOKIE_NAME)) {
    if (candidates.size >= MAX_CANDIDATE_TOKENS) break;
    const raw = cookie.value?.trim();
    if (raw && raw !== stashedToken) candidates.add(raw);
  }
  const bearer = bearerToken(req.headers)?.trim();
  if (bearer && bearer !== stashedToken && candidates.size < MAX_CANDIDATE_TOKENS) {
    candidates.add(bearer);
  }

  const durableEntries: DurableRevocationEntry[] = [];
  const redisTargets: Array<{ keys: string[]; mirror: () => Promise<{ ok: boolean; persisted: string }> }> = [];

  for (const raw of candidates) {
    const currentSession = await verifySession(raw, { skipRevocationCheck: true }).catch(() => null);
    if (!currentSession) continue;
    const tokenKeys = await buildRevocationTokenKeys(raw, currentSession.sid);
    const expiresAt = new Date(currentSession.expiresAt);
    for (const tokenKey of tokenKeys) {
      durableEntries.push({
        tokenKey,
        userId: currentSession.userId,
        tenantId: currentSession.tenantId,
        expiresAt,
        reason: 'impersonation-stop',
      });
    }
    redisTargets.push({
      keys: tokenKeys,
      mirror: () => revokeSession(raw, currentSession.expiresAt, currentSession.sid),
    });
  }

  // Fallback: if middleware forwarded x-session-id without a cookie/Bearer copy
  const headerSid = req.headers.get('x-session-id')?.trim();
  if (headerSid && authz.userId && authz.tenantId && durableEntries.length === 0) {
    const expMs = Date.now() + 60 * 60 * 1000;
    const sidKey = `${DURABLE_SID_PREFIX}${headerSid}`;
    durableEntries.push({
      tokenKey: sidKey,
      userId: authz.userId,
      tenantId: authz.tenantId,
      expiresAt: new Date(expMs),
      reason: 'impersonation-stop',
    });
    redisTargets.push({
      keys: [sidKey],
      mirror: () => revokeSessionKeyInRedis(`${SESSION_SID_KEY_PREFIX}${headerSid}`, expMs),
    });
  }

  if (durableEntries.length === 0) return { ok: true };

  const durableRes = await revokeSessionTokensDurable(durableEntries);
  if (!durableRes.ok) {
    return { ok: false, error: durableRes.error };
  }

  const syncedKeys: string[] = [];
  let anyRedisFailed = false;
  for (const target of redisTargets) {
    const rRes = await target.mirror().catch(() => ({ ok: false, persisted: 'failed' }));
    if (!rRes.ok) anyRedisFailed = true;
    else if (rRes.persisted === 'redis') syncedKeys.push(...target.keys);
  }
  if (syncedKeys.length > 0) void markRevocationTokensSynced(syncedKeys);
  if (anyRedisFailed) scheduleRevocationRedisSync();
  return { ok: true };
}

async function handlePOST(req: NextRequest) {
  const csrf = validateSameOriginCsrf(req);
  if (!csrf.ok) {
    return NextResponse.json(
      { ok: false, error: 'Forbidden', message: 'Cross-site impersonation stop request rejected.' },
      { status: 403 },
    );
  }

  const authz = requireAuthorizedTenant({ headers: req.headers, nextUrl: req.nextUrl });
  if (!authz.ok) {
    return NextResponse.json({ error: authz.error }, { status: authz.status });
  }

  try {
    const stashed = req.cookies.get(IMPERSONATOR_COOKIE_NAME)?.value;
    if (!stashed) {
      return NextResponse.json({ ok: false, error: 'No impersonation session to revert' }, { status: 400 });
    }

    const revokeRes = await revokeDiscardedImpersonationTokens(req, stashed, authz);
    if (!revokeRes.ok) {
      const res = NextResponse.json(
        { ok: false, error: 'Failed to durably revoke impersonation session' },
        { status: 503 },
      );
      res.cookies.delete(COOKIE_NAME);
      return res;
    }

    // Verify stashed impersonator session durably (Postgres + Redis) so a
    // revoked original session can never be resurrected by stopping impersonation.
    const original = await verifySessionDurable(stashed);
    if (!original) {
      // Stashed token expired or revoked — wipe both cookies and force re-login.
      const res = NextResponse.json({ ok: false, error: 'Original session expired — please sign in again.' }, { status: 401 });
      res.cookies.delete(COOKIE_NAME);
      res.cookies.delete(IMPERSONATOR_COOKIE_NAME);
      return res;
    }

    const impersonatedBy = req.headers.get('x-impersonated-by') ?? '';
    const tenantId       = req.headers.get('x-tenant-id') ?? '';
    void logAudit({
      tenantId: tenantId || undefined,
      userId: impersonatedBy || original.userId,
      userRole: 'SUPER_ADMIN',
      entityType: 'Impersonation',
      action: 'DELETE',
      details: `Impersonation ended; restored to user ${original.userId}.`,
    });

    const res = NextResponse.json({ ok: true });
    // Restore: copy stashed token back to the primary session cookie.
    res.cookies.set(COOKIE_NAME, stashed, {
      httpOnly: true, sameSite: 'lax',
      secure: process.env.NODE_ENV === 'production',
      maxAge: 24 * 60 * 60, path: '/',
    });
    res.cookies.delete(IMPERSONATOR_COOKIE_NAME);
    return res;
  } catch (err) {
    captureException(err, { context: 'admin.impersonate.stop' });
    return NextResponse.json({ ok: false, error: 'Could not stop impersonation' }, { status: 500 });
  }
}

// Privileged writes are always audited (src/lib/audited-action.ts).
export const POST = withAuditedAction(handlePOST);
