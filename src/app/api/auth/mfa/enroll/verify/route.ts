/**
 * POST /api/auth/mfa/enroll/verify
 *
 * Body: { code }  (6-digit TOTP from the authenticator app)
 *
 * - Verify the code against pending_mfa_secret.
 * - On success: copy pending_mfa_secret → mfa_secret, set mfa_enabled = TRUE,
 *   set mfa_enrolled_at, generate 10 recovery codes (sha256-hashed in DB,
 *   returned plaintext ONCE in the response).
 * - On failure: leave pending_mfa_secret in place so the user can retry.
 */

import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { getTenantContext } from '@/lib/tenant-session';
import { ensureMfaColumns } from '@/lib/auth-mfa-schema';
import { verifyTotp, generateRecoveryCodes } from '@/lib/totp';
import { logAudit } from '@/lib/audit';
import { captureException } from '@/lib/sentry';

export const runtime = 'nodejs';

export async function POST(req: NextRequest) {
  try {
    const ctx = getTenantContext(req);
    await ensureMfaColumns();

    const body = await req.json().catch(() => ({}));
    const code = String(body?.code ?? '').trim();
    if (!/^\d{6}$/.test(code)) {
      return NextResponse.json({ ok: false, error: 'Enter the 6-digit code from your authenticator app.' }, { status: 400 });
    }

    const rows = await prisma.$queryRawUnsafe<Array<{ pending_mfa_secret: string | null; mfa_enabled: boolean }>>(
      `SELECT pending_mfa_secret, mfa_enabled FROM "User" WHERE id = $1 LIMIT 1`,
      ctx.userId,
    );
    const row = rows[0];
    if (!row) return NextResponse.json({ ok: false, error: 'User not found' }, { status: 404 });
    if (row.mfa_enabled) return NextResponse.json({ ok: false, error: 'MFA is already enabled.' }, { status: 400 });
    if (!row.pending_mfa_secret) {
      return NextResponse.json({ ok: false, error: 'No enrolment in progress. Start over.' }, { status: 400 });
    }

    if (!verifyTotp(row.pending_mfa_secret, code)) {
      return NextResponse.json({ ok: false, error: 'That code is wrong or expired. Try again.' }, { status: 400 });
    }

    const { plaintext, hashed } = generateRecoveryCodes(10);

    await prisma.$executeRawUnsafe(
      `UPDATE "User"
         SET mfa_secret = pending_mfa_secret,
             pending_mfa_secret = NULL,
             mfa_enabled = TRUE,
             mfa_enrolled_at = NOW(),
             mfa_recovery_codes = $1::jsonb,
             "updatedAt" = NOW()
       WHERE id = $2`,
      JSON.stringify(hashed), ctx.userId,
    );

    void logAudit({
      tenantId: ctx.tenantId,
      userId: ctx.userId,
      userRole: 'USER',
      entityType: 'User',
      entityId: ctx.userId,
      action: 'UPDATE',
      details: 'MFA enabled (TOTP enrolment completed).',
    });

    return NextResponse.json({
      ok: true,
      recoveryCodes: plaintext,  // shown ONCE — never returned again
    });
  } catch (err) {
    if (err instanceof NextResponse) return err;
    captureException(err, { context: 'auth.mfa.enroll.verify' });
    return NextResponse.json({ ok: false, error: 'Verification failed' }, { status: 500 });
  }
}
