export const dynamic = 'force-dynamic';

/**
 * POST /api/auth/reset-password
 * Body: { token, newPassword }
 *
 *  - sha256(token) → look up password_reset_tokens row
 *  - verify not used / not revoked / not expired
 *  - validate new password against DEFAULT_PASSWORD_POLICY
 *  - update "User".password_hash (PBKDF2 hex)
 *  - mark token used + revoke any other active tokens for this user
 *  - audit log
 */

import { revokeSessionsSafely } from '@/lib/auth/session-revocation';
import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import {
  hashPassword, hashToken, validatePassword,
  DEFAULT_PASSWORD_POLICY,
} from '@/lib/password-policy';
import { logAudit } from '@/lib/audit';
import { captureException } from '@/lib/sentry';
import { trustedClientIp } from '@/lib/auth/setup-bootstrap';
import { checkResetPasswordRateLimit } from '@/lib/auth/auth-rate-limit';

export const runtime = 'nodejs';

const NO_STORE_HEADERS = { 'Cache-Control': 'no-store' };
const GENERIC_INVALID_TOKEN_ERROR = 'Invalid or expired reset link.';

export async function POST(req: NextRequest) {
  try {
    const ipAddress = trustedClientIp(req);
    const throttle = await checkResetPasswordRateLimit(ipAddress);
    if (!throttle.allowed) {
      return NextResponse.json(
        { ok: false, error: 'Too many password reset attempts. Please try again later.' },
        {
          status: 429,
          headers: {
            ...NO_STORE_HEADERS,
            'Retry-After': String(throttle.retryAfterSec),
          },
        },
      );
    }

    let body: Record<string, unknown>;
    try {
      const parsed: unknown = await req.json();
      if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
        return NextResponse.json({ ok: false, error: 'Invalid JSON' }, { status: 400, headers: NO_STORE_HEADERS });
      }
      body = parsed as Record<string, unknown>;
    } catch {
      return NextResponse.json({ ok: false, error: 'Invalid JSON' }, { status: 400, headers: NO_STORE_HEADERS });
    }

    const token       = typeof body.token === 'string' ? body.token.trim() : '';
    const newPassword = typeof body.newPassword === 'string' ? body.newPassword : '';

    if (!token || token.length < 32) {
      return NextResponse.json({ ok: false, error: GENERIC_INVALID_TOKEN_ERROR }, { status: 400, headers: NO_STORE_HEADERS });
    }

    const tokenHash = hashToken(token);
    const rows = await prisma.$queryRawUnsafe<Array<{
      id: string; user_id: string; expires_at: string; used_at: string | null; revoked: boolean;
      email: string; username: string;
    }>>(
      `SELECT t.id::text, t.user_id, t.expires_at::text, t.used_at::text, t.revoked,
              u.email, u.username
       FROM password_reset_tokens t
       JOIN "User" u ON u.id = t.user_id
       WHERE t.token_hash = $1
         AND COALESCE(u.is_active, TRUE) = TRUE
       LIMIT 1`,
      tokenHash,
    ).catch(() => []);
    if (rows.length === 0) {
      return NextResponse.json({ ok: false, error: GENERIC_INVALID_TOKEN_ERROR }, { status: 400, headers: NO_STORE_HEADERS });
    }
    const row = rows[0];

    // Unify used / revoked / expired responses to avoid leaking token state.
    if (row.used_at || row.revoked || new Date(row.expires_at) < new Date()) {
      return NextResponse.json({ ok: false, error: GENERIC_INVALID_TOKEN_ERROR }, { status: 400, headers: NO_STORE_HEADERS });
    }

    const validation = validatePassword(
      newPassword,
      { email: row.email, username: row.username },
      DEFAULT_PASSWORD_POLICY,
    );
    if (!validation.ok) {
      return NextResponse.json({ ok: false, errors: validation.errors }, { status: 400, headers: NO_STORE_HEADERS });
    }

    const hash = hashPassword(newPassword);

    // Atomic single-use token claim: only the winning transaction whose
    // conditional UPDATE affects exactly 1 row may update the user's password.
    const claimed = await prisma.$transaction(async (tx) => {
      const affected = await tx.$executeRawUnsafe(
        `UPDATE password_reset_tokens
            SET used_at = NOW()
          WHERE id = $1::uuid
            AND used_at IS NULL
            AND revoked = FALSE
            AND expires_at > NOW()`,
        row.id,
      );
      if (Number(affected) !== 1) {
        return false;
      }

      await tx.$executeRawUnsafe(
        `UPDATE "User" SET password_hash = $1, "updatedAt" = NOW() WHERE id = $2`,
        hash, row.user_id,
      );

      // Single-use trail: revoke any other still-active tokens for this user.
      await tx.$executeRawUnsafe(
        `UPDATE password_reset_tokens
            SET revoked = TRUE
          WHERE user_id = $1 AND id != $2::uuid AND used_at IS NULL AND revoked = FALSE`,
        row.user_id, row.id,
      );
      return true;
    });

    if (!claimed) {
      return NextResponse.json({ ok: false, error: GENERIC_INVALID_TOKEN_ERROR }, { status: 400, headers: NO_STORE_HEADERS });
    }

    void logAudit({
      userId: row.user_id,
      userRole: 'USER',
      entityType: 'User',
      entityId: row.user_id,
      action: 'UPDATE',
      details: `Password reset completed via reset link.`,
      ipAddress,
    });

    // Sessions opened with the old password (possibly by whoever made the
    // reset necessary) end within 60 s.
    await revokeSessionsSafely({ userId: row.user_id, reason: 'password-reset', revokedBy: row.user_id });

    return NextResponse.json({ ok: true }, { headers: NO_STORE_HEADERS });
    } catch (err) {
    captureException(err, { context: 'auth.reset-password' });
    return NextResponse.json({ ok: false, error: 'Reset failed' }, { status: 500, headers: NO_STORE_HEADERS });
  }
}
