export const dynamic = 'force-dynamic';

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
import * as QRCodeNs from 'qrcode';
import { prisma } from '@/lib/prisma';
import { getTenantContext } from '@/lib/tenant-session';
import { generateTotpSecret, provisioningUri } from '@/lib/totp';
import { captureException } from '@/lib/sentry';

export const runtime = 'nodejs';
const NO_STORE_HEADERS = { 'Cache-Control': 'no-store' };

async function generateMfaQrDataUrl(uri: string): Promise<string | null> {
  const qrMod = QRCodeNs as unknown as {
    toDataURL?: (text: string, opts?: Record<string, unknown>) => Promise<string>;
    toString?: (text: string, opts?: Record<string, unknown>) => Promise<string>;
    default?: {
      toDataURL?: (text: string, opts?: Record<string, unknown>) => Promise<string>;
      toString?: (text: string, opts?: Record<string, unknown>) => Promise<string>;
    };
  };

  const toDataURL = qrMod.toDataURL ?? qrMod.default?.toDataURL;
  if (typeof toDataURL === 'function') {
    try {
      return await toDataURL(uri, {
        errorCorrectionLevel: 'M',
        margin: 1,
        width: 240,
      });
    } catch (err) {
      console.warn('[auth/mfa/enroll] QR PNG generation failed, attempting SVG fallback:', err instanceof Error ? err.name : 'Error');
    }
  }

  const toString = qrMod.toString ?? qrMod.default?.toString;
  if (typeof toString === 'function') {
    try {
      const svg = await toString(uri, {
        type: 'svg',
        errorCorrectionLevel: 'M',
        margin: 1,
        width: 240,
      });
      return `data:image/svg+xml;base64,${Buffer.from(svg, 'utf8').toString('base64')}`;
    } catch (err) {
      console.warn('[auth/mfa/enroll] QR SVG fallback failed:', err instanceof Error ? err.name : 'Error');
    }
  }

  return null;
}

export async function POST(req: NextRequest) {
  try {
    const ctx = getTenantContext(req);

    const rows = await prisma.$queryRawUnsafe<Array<{ email: string; username: string; mfa_enabled: boolean }>>(
      `SELECT email, username, mfa_enabled FROM "User" WHERE id = $1 LIMIT 1`,
      ctx.userId,
    );
    if (rows.length === 0) {
      return NextResponse.json({ ok: false, error: 'User not found' }, { status: 404, headers: NO_STORE_HEADERS });
    }
    const user = rows[0];
    if (user.mfa_enabled) {
      return NextResponse.json(
        { ok: false, error: 'MFA is already enabled. Disable it first to re-enrol.' },
        { status: 400, headers: NO_STORE_HEADERS },
      );
    }

    const secret = generateTotpSecret();
    const issuer = 'Fleet360';
    const uri = provisioningUri({ issuer, account: user.email, secretBase32: secret });

    await prisma.$executeRawUnsafe(
      `UPDATE "User" SET pending_mfa_secret = $1, "updatedAt" = NOW() WHERE id = $2`,
      secret, ctx.userId,
    );

    // Render the otpauth:// URI as an inline PNG (or SVG fallback) data URL so
    // the page displays a scannable QR code immediately without external requests.
    const qrDataUrl = await generateMfaQrDataUrl(uri);

    return NextResponse.json(
      {
        ok: true,
        secret,            // fallback for manual entry
        otpauthUri: uri,
        qrDataUrl,         // PNG/SVG data URL ready for <img src={...}>
        issuer,
        account: user.email,
      },
      { headers: NO_STORE_HEADERS },
    );
  } catch (err) {
    if (err instanceof NextResponse) return err;
    captureException(err, { context: 'auth.mfa.enroll' });
    return NextResponse.json({ ok: false, error: 'Failed to start MFA enrolment' }, { status: 500, headers: NO_STORE_HEADERS });
  }
}
