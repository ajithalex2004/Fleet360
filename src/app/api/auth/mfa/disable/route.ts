/**
 * POST /api/auth/mfa/disable
 *
 * Body: { password, code }
 *
 * Requires both the user's password AND a current TOTP code (or a
 * recovery code). This protects against a stolen session being used
 * to weaken the account.
 */

import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { verifyTotp, verifyRecoveryCode } from '@/lib/totp';
import { verifyPassword } from '@/lib/password-policy';
import { ensureMfaColumns } from '@/lib/auth-mfa-schema';
import { logAudit } from '@/lib/audit';
import { captureException } from '@/lib/sentry';

export const runtime = 'nodejs';

export async function POST(req: NextRequest) {
  try {
    const userId = req.headers.get('x-user-id');
    if (!userId) return NextResponse.json({ ok: false, error: 'Not authenticated' }, { status: 401 });

    const body = await req.json();
    const password = String(body?.password ?? '');
    const code = String(body?.code ?? '').trim();

    if (!password) return NextResponse.json({ ok: false, error: 'Password is required' }, { status: 400 });
    if (!code) return NextResponse.json({ ok: false, error: 'TOTP or recovery code is required' }, { status: 400 });

    await ensureMfaColumns();

    const rows = await prisma.$queryRawUnsafe<Array<{
      password_hash: string | null; mfa_enabled: boolean | null;
      mfa_secret: string | null; mfa_recovery_codes: string[] | null;
    }>>(
      `SELECT password_hash, mfa_enabled, mfa_secret, mfa_recovery_codes FROM "User" WHERE id = $1`,
      userId,
    ).catch(() => []);
    if (rows.length === 0) return NextResponse.json({ ok: false, error: 'User not found' }, { status: 404 });
    const row = rows[0];

    if (!row.mfa_enabled) return NextResponse.json({ ok: false, error: 'MFA is not enabled' }, { status: 400 });
    if (!verifyPassword(password, row.password_hash)) {
      return NextResponse.json({ ok: false, error: 'Incorrect password' }, { status: 401 });
    }

    let codeOk = false;
    if (/^\d{6}$/.test(code) && row.mfa_secret) {
      codeOk = verifyTotp(row.mfa_secret, code);
    } else if (row.mfa_recovery_codes) {
      const r = verifyRecoveryCode(code, row.mfa_recovery_codes);
      codeOk = r.ok;
    }
    if (!codeOk) return NextResponse.json({ ok: false, error: 'Invalid code' }, { status: 401 });

    await prisma.$executeRawUnsafe(
      `UPDATE "User"
         SET mfa_enabled = FALSE,
             mfa_secret = NULL,
             pending_mfa_secret = NULL,
             mfa_recovery_codes = NULL,
             mfa_enrolled_at = NULL,
             "updatedAt" = NOW()
       WHERE id = $1`,
      userId,
    );

    void logAudit({
      userId, userRole: 'USER',
      entityType: 'User', entityId: userId,
      action: 'UPDATE',
      details: 'MFA disabled by user (password + code re-verified).',
    });

    return NextResponse.json({ ok: true, mfaEnabled: false });
  } catch (err) {
    captureException(err, { context: 'auth.mfa.disable' });
    return NextResponse.json({ ok: false, error: 'Disable failed' }, { status: 500 });
  }
}
