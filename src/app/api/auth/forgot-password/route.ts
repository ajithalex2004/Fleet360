export const dynamic = 'force-dynamic';

/**
 * POST /api/auth/forgot-password
 * Body: { email }
 *
 * Always returns 200 with a generic message (anti-enumeration). When a user
 * is actually found we mint a 32-byte hex token, hash it (sha256), persist
 * hash + 60 min expiry, and email a reset link.
 *
 * The raw token is sent in the email (and never stored). The hash is checked
 * on /api/auth/reset-password.
 */

import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { generateResetToken } from '@/lib/password-policy';
import { appUrl, NO_TENANT, sendTemplatedEmail } from '@/lib/email-templates';
import { runAsTenant } from '@/lib/rls-scope';
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
  const generic = () => NextResponse.json({
    ok: true,
    message: 'If an account exists for that email, a reset link has been sent.',
  });

  try {
    const userRows = await prisma.$queryRawUnsafe<Array<{ id: string; username: string }>>(
      `SELECT id, username FROM "User" WHERE LOWER(email) = $1 AND COALESCE(is_active, TRUE) = TRUE LIMIT 1`,
      email,
    ).catch(() => [] as Array<{ id: string; username: string }>);

    if (userRows.length === 0) return generic();
    const user = userRows[0];

    // Single active token: revoke any prior outstanding tokens for this user.
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

    const resetUrl = appUrl(`/reset-password?token=${encodeURIComponent(token)}`);

    // In the language of the user's organisation (English if they have none).
    const membership = await runAsTenant('*', () => prisma.$queryRawUnsafe<Array<{ tenant_id: string }>>(
      `SELECT tenant_id::text FROM user_tenants WHERE user_id = $1 AND COALESCE(is_active, TRUE) = TRUE
        ORDER BY created_at ASC LIMIT 1`,
      user.id,
    )).catch(() => [] as Array<{ tenant_id: string }>);

    const sendResult = await sendTemplatedEmail({
      tenantId: membership[0]?.tenant_id ?? NO_TENANT,
      key: 'account.password_reset',
      to: email,
      values: { userName: user.username, resetUrl, validMinutes: String(TOKEN_TTL_MIN) },
    });

    void logAudit({
      userId: user.id,
      userRole: 'USER',
      entityType: 'User',
      entityId: user.id,
      action: 'UPDATE',
      details: `Password reset requested. Email send: ${sendResult.sent ? 'OK' : `failed (${sendResult.reason ?? 'unknown'})`}.`,
    });

    return generic();
  } catch (err) {
    captureException(err, { context: 'auth.forgot-password' });
    return generic(); // still generic — never leak existence
  }
}
