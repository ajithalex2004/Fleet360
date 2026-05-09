/**
 * POST /api/auth/mfa/enroll
 *
 * Starts MFA enrolment for the logged-in user. Generates a base32 secret,
 * stores it in pending_mfa_secret (so an abandoned enrolment doesn't lock
 * the user out), and returns the secret + provisioning URI for the QR code.
 *
 * Caller must finish with /api/auth/mfa/enroll/verify to flip mfa_enabled = TRUE.
 */

import { NextRequest, NextResponse } from 'next/server';
import QRCode from 'qrcode';
import { prisma } from '@/lib/prisma';
import { getTenantContext } from '@/lib/tenant-session';
import { ensureMfaColumns } from '@/lib/auth-mfa-schema';
import { generateTotpSecret, provisioningUri } from '@/lib/totp';
import { captureException } from '@/lib/sentry';

export const runtime = 'nodejs';

export async function POST(req: NextRequest) {
  try {
    const ctx = getTenantContext(req);
    await ensureMfaColumns();

    const rows = await prisma.$queryRawUnsafe<Array<{ email: string; username: string; mfa_enabled: boolean }>>(
      `SELECT email, username, mfa_enabled FROM "User" WHERE id = $1 LIMIT 1`,
      ctx.userId,
    );
    if (rows.length === 0) {
      return NextResponse.json({ ok: false, error: 'User not found' }, { status: 404 });
    }
    const user = rows[0];
    if (user.mfa_enabled) {
      return NextResponse.json({ ok: false, error: 'MFA is already enabled. Disable it first to re-enrol.' }, { status: 400 });
    }

    const secret = generateTotpSecret();
    const issuer = 'Fleet360';
    const uri = provisioningUri({ issuer, account: user.email, secretBase32: secret });

    await prisma.$executeRawUnsafe(
      `UPDATE "User" SET pending_mfa_secret = $1, "updatedAt" = NOW() WHERE id = $2`,
      secret, ctx.userId,
    );

    // Render the otpauth:// URI as an inline PNG data URL so the page can
    // render <img src={qrDataUrl}> without any client-side QR library.
    const qrDataUrl = await QRCode.toDataURL(uri, {
      errorCorrectionLevel: 'M',
      margin: 1,
      width: 240,
    }).catch(() => null);

    return NextResponse.json({
      ok: true,
      secret,            // fallback for manual entry
      otpauthUri: uri,
      qrDataUrl,         // PNG data URL ready for <img src={...}>
      issuer,
      account: user.email,
    });
  } catch (err) {
    if (err instanceof NextResponse) return err;
    captureException(err, { context: 'auth.mfa.enroll' });
    return NextResponse.json({ ok: false, error: 'Failed to start MFA enrolment' }, { status: 500 });
  }
}
