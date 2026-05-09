/**
 * POST /api/auth/forgot-password
 *
 * Body: { email }
 * Always returns 200 with a generic message (anti-enumeration).
 *
 * If a user exists for the email we mint a 32-byte hex token, hash it
 * (sha256), persist hash + 60-min expiry, and email a reset link.
 *
 * The token itself is sent in the email (and never stored). The hash is
 * checked on /api/auth/reset-password.
 */

import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { generateResetToken } from '@/lib/password-policy';
import { sendEmail } from '@/lib/email';
import { logAudit } from '@/lib/audit';
import { captureException } from '@/lib/sentry';

export const runtime = 'nodejs';

const TOKEN_TTL_MIN = 60;

export async function POST(req: NextRequest) {
  let email: string;
  try {
    const body = await req.json();
    email = String(body?.email ?? '').trim().toLowerCase();
  } catch {
    return NextResponse.json({ ok: false, error: 'Invalid JSON' }, { status: 400 });
  }
  if (!email || !/.+@.+\..+/.test(email)) {
    return NextResponse.json({ ok: false, error: 'A valid email is required' }, { status: 400 });
  }

  // Generic response — never reveal whether the email exists.
  const genericResponse = NextResponse.json({
    ok: true,
    message: 'If an account exists for that email, a reset link has been sent.',
  });

  try {
    await ensurePasswordResetTable();

    const userRows = await prisma.$queryRawUnsafe<Array<{ id: string; username: string }>>(
      `SELECT id, username FROM "User" WHERE LOWER(email) = $1 AND COALESCE(is_active, TRUE) = TRUE LIMIT 1`,
      email,
    ).catch(() => [] as Array<{ id: string; username: string }>);

    if (userRows.length === 0) {
      return genericResponse;
    }
    const user = userRows[0];

    // Throttle: revoke any active tokens for this user.
    await prisma.$executeRawUnsafe(
      `UPDATE password_reset_tokens
         SET revoked = TRUE
       WHERE user_id = $1 AND used_at IS NULL AND revoked = FALSE
         AND expires_at > NOW()`,
      user.id,
    ).catch(() => {});

    const { token, hash } = generateResetToken();
    const expiresAt = new Date(Date.now() + TOKEN_TTL_MIN * 60_000);

    await prisma.$executeRawUnsafe(
      `INSERT INTO password_reset_tokens (user_id, token_hash, expires_at)
       VALUES ($1, $2, $3)`,
      user.id, hash, expiresAt,
    );

    const baseUrl = process.env.NEXT_PUBLIC_APP_URL ?? 'http://localhost:3000';
    const resetUrl = `${baseUrl}/reset-password?token=${encodeURIComponent(token)}`;

    const sendResult = await sendEmail({
      to: email,
      subject: 'Reset your XL AI Smart Mobility password',
      text: [
        `Hi ${user.username},`,
        '',
        'You (or someone using your email) requested a password reset for XL AI Smart Mobility.',
        '',
        `Reset your password here (valid for ${TOKEN_TTL_MIN} minutes):`,
        resetUrl,
        '',
        'If you did not request this, ignore this email — your password remains unchanged.',
        '',
        '— XL AI Smart Mobility',
      ].join('\n'),
      html:
        `<p>Hi ${escapeHtml(user.username)},</p>` +
        `<p>You (or someone using your email) requested a password reset for XL AI Smart Mobility.</p>` +
        `<p><a href="${resetUrl}" style="display:inline-block;padding:10px 18px;background:#7c3aed;color:white;border-radius:8px;text-decoration:none">Reset password</a></p>` +
        `<p style="color:#666;font-size:12px">Or copy this link: <code>${resetUrl}</code><br/>Valid for ${TOKEN_TTL_MIN} minutes.</p>` +
        `<p style="color:#666;font-size:12px">If you did not request this, ignore this email — your password remains unchanged.</p>`,
    });

    void logAudit({
      userId: user.id,
      userRole: 'USER',
      entityType: 'User',
      entityId: user.id,
      action: 'UPDATE',
      details: `Password reset requested. Email send: ${sendResult.sent ? 'OK' : `failed (${sendResult.reason ?? 'unknown'})`}.`,
    });

    return genericResponse;
  } catch (err) {
    captureException(err, { context: 'auth.forgot-password' });
    return genericResponse; // still generic — never leak existence
  }
}

async function ensurePasswordResetTable(): Promise<void> {
  await prisma.$executeRawUnsafe(`
    CREATE TABLE IF NOT EXISTS password_reset_tokens (
      id          UUID         PRIMARY KEY DEFAULT gen_random_uuid(),
      user_id     TEXT         NOT NULL,
      token_hash  TEXT         NOT NULL,
      created_at  TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
      expires_at  TIMESTAMPTZ  NOT NULL,
      used_at     TIMESTAMPTZ,
      revoked     BOOLEAN      NOT NULL DEFAULT FALSE,
      ip_address  TEXT,
      user_agent  TEXT
    )
  `);
  await prisma.$executeRawUnsafe(
    `CREATE INDEX IF NOT EXISTS idx_password_reset_tokens_hash ON password_reset_tokens (token_hash)`,
  );
  await prisma.$executeRawUnsafe(
    `CREATE INDEX IF NOT EXISTS idx_password_reset_tokens_user ON password_reset_tokens (user_id, expires_at)`,
  );
}

function escapeHtml(s: string): string {
  return s.replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]!));
}
