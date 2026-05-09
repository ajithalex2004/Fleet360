/**
 * POST /api/auth/mfa/enroll/verify
 *
 * Step 2 of TOTP enrolment. User submits the 6-digit code from their
 * authenticator app. If valid against the pending secret:
 *   - move pending_mfa_secret → mfa_secret
 *   - set mfa_enabled = TRUE
 *   - generate 10 recovery codes (returned ONCE — user MUST save them)
 *   - return the plaintext recovery codes in the response
 */

import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { verifyTotp, generateRecoveryCodes } from '@/lib/totp';
import { ensureMfaColumns } from '@/lib/auth-mfa-schema';
import { logAudit } from '@/lib/audit';
import { captureException } from '@/lib/sentry';

export const runtime = 'nodejs';

export async function POST(req: NextRequest) {
  try {
    const userId = req.headers.get('x-user-id');
    if (!userId) return NextResponse.json({ ok: false, error: 'Not authenticated' }, { status: 401 });

    const body = await req.json();
    const code = String(body?.code ?? '').trim();
    if (!/^\d{6}$/.test(code)) {
      return NextResponse.json({ ok: false, error: 'Code must be 6 digits' }, { status: 400 });
    }

    await ensureMfaColumns();

    const rows = await prisma.$queryRawUnsafe<Array<{ pending_mfa_secret: string | null; mfa_enabled: boolean | null }>>(
      `SELECT pending_mfa_secret, mfa_enabled FROM "User" WHERE id = $1`, userId,
    ).catch(() => []);
    if (rows.length === 0) return NextResponse.json({ ok: false, error: 'User not found' }, { status: 404 });
    if (rows[0].mfa_enabled) return NextResponse.json({ ok: false, error: 'MFA already enabled' }, { status: 409 });
    if (!rows[0].pending_mfa_secret) {
      return NextResponse.json({ ok: false, error: 'No pending enrolment. Start enrolment first.' }, { status: 400 });
    }

    const ok = verifyTotp(rows[0].pending_mfa_secret, code, { windowSteps: 1 });
    if (!ok) {
      return NextResponse.json({ ok: false, error: 'Invalid code. Check that your phone\'s clock is correct and try again.' }, { status: 400 });
    }

    const { codes, hashes } = generateRecoveryCodes(10);

    await prisma.$executeRawUnsafe(
      `UPDATE "User"
         SET mfa_secret = pending_mfa_secret,
             pending_mfa_secret = NULL,
             mfa_enabled = TRUE,
             mfa_recovery_codes = $1::jsonb,
             mfa_enrolled_at = NOW(),
             "updatedAt" = NOW()
       WHERE id = $2`,
      JSON.stringify(hashes), userId,
    );

    void logAudit({
      userId, userRole: 'USER',
      entityType: 'User', entityId: userId,
      action: 'UPDATE',
      details: 'MFA enabled — 10 recovery codes generated.',
    });

    return NextResponse.json({
      ok: true,
      mfaEnabled: true,
      recoveryCodes: codes,
      message: 'MFA is now enabled. Save these recovery codes somewhere safe — each can be used once if you lose access to your authenticator.',
    });
  } catch (err) {
    captureException(err, { context: 'auth.mfa.enroll.verify' });
    return NextResponse.json({ ok: false, error: 'Verify failed' }, { status: 500 });
  }
}
