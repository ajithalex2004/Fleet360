/**
 * POST /api/auth/mfa/enroll
 *
 * Step 1 of TOTP enrolment. Authenticated user requests a fresh secret +
 * provisioning URI. They scan the QR (or copy the secret) into their
 * authenticator app, then call /enroll/verify with a 6-digit code to
 * complete enrolment.
 *
 * The secret is stored as `pending_mfa_secret` until verified — so a
 * crashed-out half-enrolment doesn't lock the user out.
 */

import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { generateTotpSecret, provisioningUri } from '@/lib/totp';
import { ensureMfaColumns } from '@/lib/auth-mfa-schema';
import { logAudit } from '@/lib/audit';
import { captureException } from '@/lib/sentry';

export const runtime = 'nodejs';

const ISSUER = 'XL AI Smart Mobility';

export async function POST(req: NextRequest) {
  try {
    const userId = req.headers.get('x-user-id');
    if (!userId) {
      return NextResponse.json({ ok: false, error: 'Not authenticated' }, { status: 401 });
    }
    await ensureMfaColumns();

    const rows = await prisma.$queryRawUnsafe<Array<{ email: string; mfa_enabled: boolean | null }>>(
      `SELECT email, mfa_enabled FROM "User" WHERE id = $1`, userId,
    ).catch(() => []);
    if (rows.length === 0) {
      return NextResponse.json({ ok: false, error: 'User not found' }, { status: 404 });
    }
    if (rows[0].mfa_enabled) {
      return NextResponse.json({ ok: false, error: 'MFA is already enabled. Disable it first to re-enrol.' }, { status: 409 });
    }

    const { base32 } = generateTotpSecret(20);
    const uri = provisioningUri({
      accountName: rows[0].email,
      issuer: ISSUER,
      secretBase32: base32,
    });

    await prisma.$executeRawUnsafe(
      `UPDATE "User" SET pending_mfa_secret = $1, "updatedAt" = NOW() WHERE id = $2`,
      base32, userId,
    );

    void logAudit({
      userId,
      userRole: 'USER',
      entityType: 'User',
      entityId: userId,
      action: 'UPDATE',
      details: 'MFA enrolment started — secret issued, awaiting code verification.',
    });

    return NextResponse.json({
      ok: true,
      secret: base32,
      provisioningUri: uri,
      issuer: ISSUER,
      qrCodeUrl: `https://chart.googleapis.com/chart?cht=qr&chs=240x240&chld=M|0&chl=${encodeURIComponent(uri)}`,
    });
  } catch (err) {
    captureException(err, { context: 'auth.mfa.enroll' });
    return NextResponse.json({ ok: false, error: 'Enrolment start failed' }, { status: 500 });
  }
}
