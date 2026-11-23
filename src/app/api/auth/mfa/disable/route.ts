export const dynamic = 'force-dynamic';

/**
 * POST /api/auth/mfa/disable
 *
 * Body: { password, code? , recoveryCode? }
 *
 * Re-authenticates the user (password is required) AND requires either a
 * valid TOTP code or a valid recovery code, then clears all MFA state.
 *
 * Stops a session-hijacker from disabling MFA without the second factor.
 */

import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { getTenantContext } from '@/lib/tenant-session';
import { verifyTotp, verifyRecoveryCode } from '@/lib/totp';
import { verifyPassword } from '@/lib/password-policy';
import { logAudit } from '@/lib/audit';
import { captureException } from '@/lib/sentry';
import { consumeMfaAttempt, clearMfaFailures } from '@/lib/auth/auth-rate-limit';

export const runtime = 'nodejs';
const NO_STORE_HEADERS = { 'Cache-Control': 'no-store' };

export async function POST(req: NextRequest) {
  try {
    const ctx = getTenantContext(req);

    const body = await req.json().catch(() => ({}));
    const password     = String(body?.password ?? '');
    const code         = body?.code         ? String(body.code).trim()         : null;
    const recoveryCode = body?.recoveryCode ? String(body.recoveryCode).trim() : null;

    if (!password) {
      return NextResponse.json({ ok: false, error: 'Password is required.' }, { status: 400, headers: NO_STORE_HEADERS });
    }
    if (!code && !recoveryCode) {
      return NextResponse.json({ ok: false, error: 'Provide either an authenticator code or a recovery code.' }, { status: 400, headers: NO_STORE_HEADERS });
    }

    // Atomic increment-before-verify defeats concurrent burst (TOCTOU) attacks.
    const throttle = await consumeMfaAttempt(ctx.userId);
    if (!throttle.allowed) {
      return NextResponse.json(
        { ok: false, error: `Too many failed verification attempts. Retry after ${throttle.retryAfterSec}s.` },
        { status: 429, headers: { ...NO_STORE_HEADERS, 'Retry-After': String(throttle.retryAfterSec) } },
      );
    }

    const rows = await prisma.$queryRawUnsafe<Array<{
      password_hash: string | null; mfa_enabled: boolean; mfa_secret: string | null;
      mfa_recovery_codes: string[] | null;
    }>>(
      `SELECT password_hash, mfa_enabled, mfa_secret, mfa_recovery_codes
       FROM "User" WHERE id = $1 LIMIT 1`,
      ctx.userId,
    );
    const row = rows[0];
    if (!row) return NextResponse.json({ ok: false, error: 'User not found' }, { status: 404, headers: NO_STORE_HEADERS });
    if (!row.mfa_enabled) return NextResponse.json({ ok: false, error: 'MFA is not enabled.' }, { status: 400, headers: NO_STORE_HEADERS });
    if (!row.password_hash || !verifyPassword(password, row.password_hash)) {
      return NextResponse.json({ ok: false, error: 'Wrong password.' }, { status: 401, headers: NO_STORE_HEADERS });
    }

    let secondFactorOk = false;
    let matchedRecoveryHash: string | null = null;
    if (code && row.mfa_secret) {
      secondFactorOk = verifyTotp(row.mfa_secret, code);
    }
    if (!secondFactorOk && recoveryCode) {
      const stored = Array.isArray(row.mfa_recovery_codes) ? row.mfa_recovery_codes : [];
      matchedRecoveryHash = verifyRecoveryCode(recoveryCode, stored);
      if (matchedRecoveryHash) secondFactorOk = true;
    }
    if (!secondFactorOk) {
      return NextResponse.json({ ok: false, error: 'Second factor verification failed.' }, { status: 401, headers: NO_STORE_HEADERS });
    }

    // Atomic conditional UPDATE: when disabling with a recovery code, assert the
    // matched hash is still present so concurrent login/disable replay fails closed.
    const affected = matchedRecoveryHash
      ? await prisma.$executeRawUnsafe(
          `UPDATE "User"
              SET mfa_enabled = FALSE,
                  mfa_secret = NULL,
                  pending_mfa_secret = NULL,
                  mfa_recovery_codes = NULL,
                  mfa_enrolled_at = NULL,
                  "updatedAt" = NOW()
            WHERE id = $1
              AND mfa_enabled = TRUE
              AND mfa_recovery_codes IS NOT NULL
              AND mfa_recovery_codes @> jsonb_build_array($2::text)`,
          ctx.userId,
          matchedRecoveryHash,
        )
      : await prisma.$executeRawUnsafe(
          `UPDATE "User"
              SET mfa_enabled = FALSE,
                  mfa_secret = NULL,
                  pending_mfa_secret = NULL,
                  mfa_recovery_codes = NULL,
                  mfa_enrolled_at = NULL,
                  "updatedAt" = NOW()
            WHERE id = $1 AND mfa_enabled = TRUE`,
          ctx.userId,
        );

    if (Number(affected) !== 1) {
      return NextResponse.json(
        {
          ok: false,
          error: matchedRecoveryHash ? 'Second factor verification failed.' : 'MFA is not enabled.',
        },
        { status: matchedRecoveryHash ? 401 : 400, headers: NO_STORE_HEADERS },
      );
    }

    await clearMfaFailures(ctx.userId);

    void logAudit({
      tenantId: ctx.tenantId,
      userId: ctx.userId,
      userRole: 'USER',
      entityType: 'User',
      entityId: ctx.userId,
      action: 'UPDATE',
      details: 'MFA disabled by user (password + second-factor confirmed).',
    });

    return NextResponse.json({ ok: true }, { headers: NO_STORE_HEADERS });
    } catch (err) {
    if (err instanceof NextResponse) return err;
    captureException(err, { context: 'auth.mfa.disable' });
    return NextResponse.json({ ok: false, error: 'Disable failed' }, { status: 500, headers: NO_STORE_HEADERS });
  }
}
