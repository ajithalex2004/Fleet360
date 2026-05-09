/**
 * GET /api/auth/mfa/status
 * Returns whether MFA is currently enabled for the logged-in user.
 */

import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { getTenantContext } from '@/lib/tenant-session';
import { ensureMfaColumns } from '@/lib/auth-mfa-schema';

export const runtime = 'nodejs';

export async function GET(req: NextRequest) {
  try {
    const ctx = getTenantContext(req);
    await ensureMfaColumns();
    const rows = await prisma.$queryRawUnsafe<{ mfa_enabled: boolean; mfa_enrolled_at: string | null }[]>(
      `SELECT mfa_enabled, mfa_enrolled_at::text FROM "User" WHERE id = $1 LIMIT 1`,
      ctx.userId,
    );
    const row = rows[0];
    return NextResponse.json({
      ok: true,
      mfaEnabled:    !!row?.mfa_enabled,
      mfaEnrolledAt:  row?.mfa_enrolled_at ?? null,
    });
  } catch (err) {
    if (err instanceof NextResponse) return err;
    return NextResponse.json({ ok: false, error: 'Failed to read MFA status' }, { status: 500 });
  }
}
