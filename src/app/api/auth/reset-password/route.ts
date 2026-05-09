/**
 * POST /api/auth/reset-password
 *
 * Body: { token, newPassword }
 *
 * - Hash the supplied token (sha256) and look up an active row in
 *   password_reset_tokens.
 * - Verify not expired, not used, not revoked.
 * - Validate the new password against DEFAULT_PASSWORD_POLICY.
 * - Update users.password (PBKDF2 hash format).
 * - Mark the token used and revoke any other active tokens for this user.
 * - Audit log.
 */

import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import {
  hashPassword, hashToken, validatePassword,
  DEFAULT_PASSWORD_POLICY,
} from '@/lib/password-policy';
import { logAudit } from '@/lib/audit';
import { captureException } from '@/lib/sentry';

export const runtime = 'nodejs';

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const token = String(body?.token ?? '').trim();
    const newPassword = String(body?.newPassword ?? '');

    if (!token || token.length < 32) {
      return NextResponse.json({ ok: false, error: 'Invalid or missing token' }, { status: 400 });
    }

    const tokenHash = hashToken(token);
    const rows = await prisma.$queryRawUnsafe<Array<{
      id: string; user_id: string; expires_at: string; used_at: string | null; revoked: boolean;
      email: string; username: string;
    }>>(
      `SELECT t.id::text, t.user_id::text, t.expires_at::text, t.used_at::text, t.revoked,
              u.email, u.username
       FROM password_reset_tokens t
       JOIN "User" u ON u.id = t.user_id::text
       WHERE t.token_hash = $1
       LIMIT 1`,
      tokenHash,
    ).catch(() => []);
    if (rows.length === 0) {
      return NextResponse.json({ ok: false, error: 'Invalid or expired token' }, { status: 400 });
    }
    const row = rows[0];

    if (row.used_at) return NextResponse.json({ ok: false, error: 'Token has already been used' }, { status: 400 });
    if (row.revoked) return NextResponse.json({ ok: false, error: 'Token has been revoked' }, { status: 400 });
    if (new Date(row.expires_at) < new Date()) {
      return NextResponse.json({ ok: false, error: 'Token has expired' }, { status: 400 });
    }

    const validation = validatePassword(
      newPassword,
      { email: row.email, username: row.username },
      DEFAULT_PASSWORD_POLICY,
    );
    if (!validation.ok) {
      return NextResponse.json({ ok: false, errors: validation.errors }, { status: 400 });
    }

    const hash = hashPassword(newPassword);

    await prisma.$transaction([
      prisma.$executeRawUnsafe(
        `UPDATE "User" SET password_hash = $1, "updatedAt" = NOW() WHERE id = $2`,
        hash, row.user_id,
      ),
      prisma.$executeRawUnsafe(
        `UPDATE password_reset_tokens SET used_at = NOW() WHERE id = $1::uuid`,
        row.id,
      ),
      // Revoke any other active tokens for this user — single-use trail.
      prisma.$executeRawUnsafe(
        `UPDATE password_reset_tokens
           SET revoked = TRUE
         WHERE user_id = $1 AND id != $2::uuid AND used_at IS NULL AND revoked = FALSE`,
        row.user_id, row.id,
      ),
    ]);

    void logAudit({
      userId: row.user_id,
      userRole: 'USER',
      entityType: 'User',
      entityId: row.user_id,
      action: 'UPDATE',
      details: `Password reset completed via reset link.`,
    });

    return NextResponse.json({ ok: true });
  } catch (err) {
    captureException(err, { context: 'auth.reset-password' });
    return NextResponse.json({ ok: false, error: 'Reset failed' }, { status: 500 });
  }
}
