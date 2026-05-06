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
import { ensureMfaColumns } from '@/lib/auth-mfa-schema';
import { verifyTotp, verifyRecoveryCode } from '@/lib/totp';
import { verifyPassword } from '@/lib/password-policy';
import { logAudit } from '@/lib/audit';
import { captureException } from '@/lib/sentry';

export const runtime = 'nodejs';

export async function POST(req: NextRequest) {
  try {
    const ctx = getTenantContext(req);
    await ensureMfaColumns();

    const body = await req.json().catch(() => ({}));
    const password     = String(body?.password ?? '');
    const code         = body?.code         ? String(body.code).trim()         : null;
    const recoveryCode = body?.recoveryCode ? String(body.recoveryCode).trim() : null;

    if (!password) {
      return NextResponse.json({ ok: false, error: 'Password is required.' }, { status: 400 });
    }
    if (!code && !recoveryCode) {
      return NextResponse.json({ ok: false, error: 'Provide either an authenticator code or a recovery code.' }, { status: 400 });
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
    if (!row) return NextResponse.json({ ok: false, error: 'User not found' }, { status: 404 });
    if (!row.mfa_enabled) return NextResponse.json({ ok: false, error: 'MFA is not enabled.' }, { status: 400 });
    if (!row.password_hash || !verifyPassword(password, row.password_hash)) {
      return NextResponse.json({ ok: false, error: 'Wrong password.' }, { status: 401 });
    }

    let secondFactorOk = false;
    if (code && row.mfa_secret) {
      secondFactorOk = verifyTotp(row.mfa_secret, code);
    }
    if (!secondFactorOk && recoveryCode) {
      const stored = Array.isArray(row.mfa_recovery_codes) ? row.mfa_recovery_codes : [];
      const matched = verifyRecoveryCode(recoveryCode, stored);
      if (matched) secondFactorOk = true;
    }
    if (!secondFactorOk) {
      return NextResponse.json({ ok: false, error: 'Second factor verification failed.' }, { status: 401 });
    }

    await prisma.$executeRawUnsafe(
      `UPDATE "User"
         SET mfa_enabled = FALSE,
             mfa_secret = NULL,
             pending_mfa_secret = NULL,
             mfa_recovery_codes = NULL,
             mfa_enrolled_at = NULL,
             "updatedAt" = NOW()
       WHERE id = $1`,
      ctx.userId,
    );

    void logAudit({
      tenantId: ctx.tenantId,
      userId: ctx.userId,
      userRole: 'USER',
      entityType: 'User',
      entityId: ctx.userId,
      action: 'UPDATE',
      details: 'MFA disabled by user (password + second-factor confirmed).',
    });

    return NextResponse.json({ ok: true });
  } catch (err) {
    if (err instanceof NextResponse) return err;
    captureException(err, { context: 'auth.mfa.disable' });
    return NextResponse.json({ ok: false, error: 'Disable failed' }, { status: 500 });
  }
}
